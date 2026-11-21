"""Loaded automatically by every collector that run_all.py starts (run_all puts this folder on PYTHONPATH).

Government and exchange sites (NSDL, DPIIT, NSE) often drop a connection without answering ("Remote end closed connection")
or time out under load. Every requests Session, including the one behind requests.get/post, retries those: 4 tries with
2, 4 and 8 seconds between them, on connection errors, read timeouts and HTTP 429/500/502/503/504. POSTs are retried too:
the collectors only POST to read report pages, never to change anything.
"""
try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    _RETRY = Retry(total=4, connect=4, read=4, status=4, backoff_factor=2, status_forcelist=(429, 500, 502, 503, 504),
                   allowed_methods=None, raise_on_status=False, respect_retry_after_header=True)
    _init = requests.Session.__init__

    def _session_init(self, *a, **k):
        _init(self, *a, **k)
        ad = HTTPAdapter(max_retries=_RETRY)
        self.mount("https://", ad); self.mount("http://", ad)

    requests.Session.__init__ = _session_init
except Exception as e:  # never stop a collector because the retry layer could not load
    print(f"(retry layer not loaded: {e})")
