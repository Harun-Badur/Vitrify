"""Authenticated local HTTP adapter for rembg; no paid image APIs."""
import base64
import json
import os
import threading
from collections import deque
from time import monotonic
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from PIL.Image import DecompressionBombError as ImageError

from processor import MAX_IMAGE_BYTES, cutout_png
from v2 import run_job, transport


def authorized(header: str, supabase_url: str, anon_key: str) -> bool:
    if not header.startswith("Bearer ") or len(header) > 8192:
        return False
    request = Request(
        f"{supabase_url.rstrip('/')}/auth/v1/user",
        headers={"Authorization": header, "apikey": anon_key},
    )
    try:
        with urlopen(request, timeout=10) as response:
            user = json.load(response)
            return bool(user.get("id")) and user.get("is_anonymous") is not True
    except (HTTPError, URLError, TimeoutError, ValueError):
        return False


class BoundedHTTPServer(ThreadingHTTPServer):
    """Bound threads even for clients which stall before sending HTTP headers."""
    def __init__(self, *args, **kwargs):
        self._slots = threading.BoundedSemaphore(8)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


def make_handler(supabase_url, anon_key, session, remove, v1_requests_per_minute=12):
    inference_lock = threading.Lock()
    admission_lock = threading.Lock()
    admissions = deque()
    if not 1 <= v1_requests_per_minute <= 60:
        raise ValueError("Invalid V1 request limit")

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(20)
            super().setup()

        def log_message(self, *args):
            # Never log user photos, tokens or request headers.
            pass

        def respond(self, status, body):
            value = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(value)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(value)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path == "/health":
                self.respond(200, {"ok": True})
            else:
                self.respond(404, {"error": "Not found"})

        def do_POST(self):
            if self.path == "/v2/wardrobe/cutout":
                if os.environ.get("WARDROBE_CUTOUT_V2_ENABLED", "false") != "true":
                    self.respond(503, {"code": "V2_DISABLED"})
                    return
                if not inference_lock.acquire(blocking=False):
                    self.respond(503, {"code": "V2_BUSY"})
                    return
                try:
                    self.connection.settimeout(20)
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 2048:
                        raise ValueError("V2_BODY_INVALID")
                    value = json.loads(self.rfile.read(length))
                    # Host-configured Supabase Functions origin, never request URL.
                    result = run_job(value.get("jobId"), value.get("claimCapability"),
                                     transport(os.environ["CUTOUT_V2_FUNCTIONS_BASE"]),
                                     lambda data: cutout_png(data, session, remove))
                    self.respond(200, result)
                except Exception:
                    # No raw exception/provider response/capability in logs or response.
                    self.respond(503, {"code": "V2_UNVERIFIED"})
                finally:
                    inference_lock.release()
                return
            if self.path != "/v1/wardrobe/cutout":
                self.respond(404, {"error": "Not found"})
                return
            # Single-replica, service-wide cap. No IP, user ID or JWT retained.
            # Includes rejected requests so auth traffic is bounded as well.
            with admission_lock:
                now = monotonic()
                while admissions and admissions[0] <= now - 60:
                    admissions.popleft()
                limited = len(admissions) >= v1_requests_per_minute
                if not limited:
                    admissions.append(now)
            if limited:
                self.respond(429, {"code": "V1_RATE_LIMITED"})
                return
            if not authorized(
                self.headers.get("Authorization", ""), supabase_url, anon_key
            ):
                self.respond(401, {"error": "Unauthorized"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if not 0 < length <= MAX_IMAGE_BYTES:
                self.respond(413, {"error": "Invalid image size"})
                return
            if self.headers.get("Content-Type", "").split(";")[0] != "image/jpeg":
                self.respond(415, {"error": "Expected normalized JPEG"})
                return
            if not inference_lock.acquire(blocking=False):
                self.respond(503, {"error": "Processor busy; retry later"})
                return
            try:
                self.connection.settimeout(20)
                data = self.rfile.read(length)
                if len(data) != length:
                    raise ValueError("Incomplete image")
                png = cutout_png(data, session, remove)
                self.respond(200, {"pngBase64": base64.b64encode(png).decode("ascii")})
            except (ValueError, OSError, ImageError):
                self.respond(422, {"error": "Image could not be processed"})
            except Exception:
                self.respond(500, {"error": "Background removal failed"})
            finally:
                inference_lock.release()

    return Handler


def main():
    from rembg import new_session, remove

    supabase_url = os.environ["SUPABASE_URL"]
    anon_key = os.environ["SUPABASE_ANON_KEY"]
    if not supabase_url.startswith("https://"):
        raise ValueError("SUPABASE_URL must use HTTPS")
    model = os.environ.get("WARDROBE_CUTOUT_MODEL", "u2netp")
    if model not in {"u2netp", "u2net"}:
        raise ValueError("Only local U2-Net models are supported")
    session = new_session(model, providers=["CPUExecutionProvider"])
    handler = make_handler(supabase_url, anon_key, session, remove,
                           int(os.environ.get("WARDROBE_CUTOUT_V1_REQUESTS_PER_MINUTE", "12")))
    server = BoundedHTTPServer(
        (os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", "7010"))),
        handler,
    )
    print("Wardrobe cutout CPU service ready", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
