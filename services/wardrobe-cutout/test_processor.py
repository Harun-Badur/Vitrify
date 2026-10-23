import json
import unittest
from email.message import Message
from io import BytesIO
from unittest.mock import Mock, patch
from PIL import Image
from processor import cutout_png
from server import authorized, make_handler, BoundedHTTPServer


def photo():
    buffer = BytesIO()
    image = Image.new("RGB", (20, 30), "red")
    exif = image.getexif()
    exif[270] = "Private source metadata"
    image.save(buffer, "JPEG", exif=exif)
    return buffer.getvalue()


def remove_fixture(image, session):
    output = image.convert("RGBA")
    output.putpixel((0, 0), (255, 0, 0, 0))
    return output


class ProcessorTests(unittest.TestCase):
    def test_public_rate_limit_precedes_auth_and_photo_read(self):
        handler_type = make_handler("https://project.supabase.co", "anon", None, remove_fixture,
                                    v1_requests_per_minute=1)
        handler = handler_type.__new__(handler_type)
        handler.path = "/v1/wardrobe/cutout"
        handler.headers = Message()
        handler.respond = Mock()
        handler.rfile = Mock()
        with patch("server.authorized", return_value=False) as auth:
            handler.do_POST()
            handler.do_POST()
        self.assertEqual(auth.call_count, 1)
        self.assertEqual(handler.respond.call_args.args, (429, {"code": "V1_RATE_LIMITED"}))
        handler.rfile.read.assert_not_called()

    def test_anonymous_auth_user_cannot_start_inference(self):
        response = Mock()
        response.read.return_value = b'{"id":"fixture","is_anonymous":true}'
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch("server.urlopen", return_value=response):
            self.assertFalse(authorized("Bearer fixture", "https://project.supabase.co", "anon"))
        response.read.return_value = b'{"id":"fixture","is_anonymous":false}'
        with patch("server.urlopen", return_value=response):
            self.assertTrue(authorized("Bearer fixture", "https://project.supabase.co", "anon"))

    def test_connection_overflow_is_rejected_without_a_worker(self):
        server = BoundedHTTPServer.__new__(BoundedHTTPServer)
        server._slots = Mock()
        server._slots.acquire.return_value = False
        server.shutdown_request = Mock()
        request = Mock()
        server.process_request(request, ("fixture", 1))
        request.sendall.assert_called_once()
        self.assertIn(b"503", request.sendall.call_args.args[0])
        server.shutdown_request.assert_called_once_with(request)

    def test_exports_rgba_png_and_preserves_original_bytes(self):
        original = photo()
        unchanged = bytes(original)
        output = cutout_png(original, None, remove_fixture)
        with Image.open(BytesIO(output)) as image:
            self.assertEqual(image.format, "PNG")
            self.assertEqual(image.mode, "RGBA")
            self.assertEqual(image.getchannel("A").getextrema(), (0, 255))
            self.assertEqual(len(image.getexif()), 0)
        self.assertEqual(original, unchanged)

    def test_rejects_invalid_image_and_unusable_masks(self):
        with self.assertRaises(OSError):
            cutout_png(b"not an image", None, remove_fixture)
        for alpha in (0, 255):
            with self.assertRaises(ValueError):
                cutout_png(
                    photo(), None,
                    lambda image, session: Image.new("RGBA", image.size, (0, 0, 0, alpha)),
                )

    def test_endpoint_requires_auth_before_processing(self):
        handler_type = make_handler("https://project.supabase.co", "anon", None, remove_fixture)
        handler = handler_type.__new__(handler_type)
        handler.path = "/v1/wardrobe/cutout"
        handler.headers = Message()
        handler.respond = Mock()
        with patch("server.authorized", return_value=False):
            handler.do_POST()
        handler.respond.assert_called_once_with(401, {"error": "Unauthorized"})

    def test_endpoint_returns_png_and_does_not_accept_image_urls(self):
        handler_type = make_handler("https://project.supabase.co", "anon", None, remove_fixture)
        handler = handler_type.__new__(handler_type)
        handler.path = "/v1/wardrobe/cutout"
        handler.headers = Message()
        handler.headers["Content-Type"] = "image/jpeg"
        original = photo()
        handler.headers["Content-Length"] = str(len(original))
        handler.rfile = BytesIO(original)
        handler.connection = Mock()
        handler.respond = Mock()
        with patch("server.authorized", return_value=True):
            handler.do_POST()
        status, body = handler.respond.call_args.args
        self.assertEqual(status, 200)
        self.assertTrue(body["pngBase64"].startswith("iVBOR"))
        handler.headers.replace_header("Content-Type", "application/json")
        handler.rfile = BytesIO(json.dumps({"url": "https://catalog/item.jpg"}).encode())
        with patch("server.authorized", return_value=True):
            handler.do_POST()
        self.assertEqual(handler.respond.call_args.args[0], 415)

    def test_auth_rejects_missing_token_without_network_call(self):
        with patch("server.urlopen") as fetch:
            self.assertFalse(authorized("", "https://project.supabase.co", "anon"))
            fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
