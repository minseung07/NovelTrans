# NovelTrans Connector Plugin SDK

NovelTrans discovers third-party site connectors through Python entry points.
This keeps risky site support opt-in and lets policy updates disable collection
without changing the core pipeline.

## Entry Point

Package a connector and expose it under the `noveltrans.connectors` group:

```toml
[project.entry-points."noveltrans.connectors"]
my_site = "my_package.my_site:make_connector"
```

The factory must return an instance of `noveltrans.connectors.base.NovelConnector`.

## Connector Contract

```python
from noveltrans.connectors.base import NovelConnector
from noveltrans.models import ConnectorPolicy, EpisodeMetadata, EpisodeText, WorkMetadata

class MyConnector(NovelConnector):
    def detect(self, source: str) -> bool: ...
    def get_policy(self) -> ConnectorPolicy: ...
    def get_work_metadata(self, source: str) -> WorkMetadata: ...
    def list_episodes(self, source: str) -> list[EpisodeMetadata]: ...
    def fetch_episode(self, episode: EpisodeMetadata) -> EpisodeText: ...

def make_connector() -> NovelConnector:
    return MyConnector()
```

`fetch_episode` must raise `PolicyViolation` when the current policy does not
allow automatic body collection. Do not implement cookie import, paywall bypass,
CAPTCHA bypass, or login-session scraping.

## Policy Update File

Admins can update local site policy without changing connector code:

```json
{
  "version": 1,
  "policies": {
    "My Site": {
      "site_name": "My Site",
      "grade": "C",
      "auto_fetch_allowed": false,
      "requires_official_api": false,
      "requires_user_permission": true,
      "supports_login": false,
      "max_rps": 0,
      "notes": "User-provided text only.",
      "allowed_input_modes": ["txt", "html", "zip", "clipboard"]
    }
  }
}
```

The settings menu can import this JSON from a local file or HTTPS URL.
