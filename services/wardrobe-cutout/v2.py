"""V2 job protocol; no Storage/DB credentials, no retry or disk persistence."""
import json
import re
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.parse import urlsplit, parse_qs

LIMIT = 12 * 1024 * 1024
UUID = re.compile(r"^[a-fA-F0-9-]{36}$")
TOKEN = re.compile(r"^[a-f0-9]{64}$")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a job capability across redirects.


def transport(base_url):
    if not base_url.startswith("https://"):
        raise ValueError("V2_HTTPS_REQUIRED")
    opener = build_opener(NoRedirect())

    def send(route, method, capability, body=None, png=False):
        headers = {"x-cutout-capability": capability, "Cache-Control": "no-store"}
        if png:
            headers.update({"Content-Type": "image/png", "x-cutout-protocol": "vitrify.cutout.v2"})
            headers["x-cutout-job"] = parse_qs(urlsplit(route).query)["jobId"][0]
            route = urlsplit(route).path
        else:
            headers["Content-Type"] = "application/json"
        # Routes only originate below; no URL or path supplied by callers.
        request = Request(base_url.rstrip("/") + route, data=body, headers=headers, method=method)
        with opener.open(request, timeout=60) as response:
            value = response.read(LIMIT + 1)
            if len(value) > LIMIT:
                raise ValueError("V2_RESPONSE_TOO_LARGE")
            return value
    return send


def run_job(job, claim_capability, send, process):
    if not isinstance(job, str) or not UUID.fullmatch(job) or not isinstance(claim_capability, str) or not TOKEN.fullmatch(claim_capability):
        raise ValueError("V2_IDENTITY_INVALID")
    # A lost claim response never permits CPU. No retry, even if the server committed.
    claim = json.loads(send("/wardrobe-cutout-control/claim", "POST", claim_capability,
                            json.dumps({"jobId": job}).encode()))
    token = claim.get("completionCapability", "")
    if claim.get("claimed") is not True or claim.get("jobId") != job or not isinstance(token, str) or not TOKEN.fullmatch(token):
        raise ValueError("V2_CLAIM_UNVERIFIED")
    source = send(f"/wardrobe-cutout-control/source?jobId={job}", "GET", token)
    if not source or len(source) > LIMIT:
        raise ValueError("V2_SOURCE_INVALID")
    png = process(source)
    if not png or len(png) > LIMIT:
        raise ValueError("V2_ARTIFACT_INVALID")
    # Single attempt to existing sole writer. No direct Storage API or signed upload.
    # The immutable job ID goes in the header, not a caller-selected object path.
    result = json.loads(send(f"/account-storage-upload?jobId={job}", "POST", token, png, True))
    if result.get("protocol") != "vitrify.cutout.v2" or result.get("state") != "SUCCEEDED" or result.get("resultId") != job:
        raise ValueError("V2_COMPLETION_UNVERIFIED")
    return {"state": "SUCCEEDED", "jobId": job}
