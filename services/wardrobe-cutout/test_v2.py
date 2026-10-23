import json
import unittest
from unittest.mock import Mock
from v2 import run_job

JOB = "11111111-1111-4111-8111-111111111111"


class V2Tests(unittest.TestCase):
    def test_lost_claim_never_runs_cpu_or_retries(self):
        send = Mock(side_effect=TimeoutError())
        process = Mock()
        with self.assertRaises(TimeoutError):
            run_job(JOB, "a" * 64, send, process)
        process.assert_not_called()
        self.assertEqual(send.call_count, 1)

    def test_duplicate_claim_denied_before_cpu(self):
        send = Mock(return_value=b'{"claimed":false}')
        process = Mock()
        with self.assertRaises(ValueError):
            run_job(JOB, "a" * 64, send, process)
        process.assert_not_called()

    def test_completion_timeout_does_not_repeat_inference_or_upload(self):
        send = Mock(side_effect=[json.dumps({"claimed": True, "jobId": JOB, "completionCapability": "b" * 64}).encode(),
                                 b"source", TimeoutError()])
        process = Mock(return_value=b"png")
        with self.assertRaises(TimeoutError):
            run_job(JOB, "a" * 64, send, process)
        process.assert_called_once_with(b"source")
        self.assertEqual(send.call_count, 3)

    def test_success_only_after_same_job_cloud_receipt(self):
        send = Mock(side_effect=[json.dumps({"claimed": True, "jobId": JOB, "completionCapability": "b" * 64}).encode(),
                                 b"source", json.dumps({"protocol": "vitrify.cutout.v2", "state": "SUCCEEDED", "resultId": JOB}).encode()])
        self.assertEqual(run_job(JOB, "a" * 64, send, Mock(return_value=b"png"))["state"], "SUCCEEDED")
        self.assertIn("account-storage-upload", send.call_args.args[0])

    def test_foreign_late_result_is_not_success(self):
        send = Mock(side_effect=[json.dumps({"claimed": True, "jobId": JOB, "completionCapability": "b" * 64}).encode(),
                                 b"source", b'{"protocol":"vitrify.cutout.v2","state":"SUCCEEDED","resultId":"other"}'])
        with self.assertRaises(ValueError):
            run_job(JOB, "a" * 64, send, Mock(return_value=b"png"))


if __name__ == "__main__":
    unittest.main()
