# Video and image engine matrix

This matrix records the implemented adapters and offline checks. It is **not** a live quality or price benchmark. Model availability, regional access, provider limits and billing still need account-specific verification with a key and an approved spending cap.

| Protocol          | Implemented path                                    | Reference behavior                                                                      | Offline evidence                                                                | Live state                          |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| Gemini Veo 3.1    | Async submit, poll, download                        | Up to three approved identity images; eight-second shots when using identity references | Request shape, operation mapping and combined duration/resolution limits tested | Pending credentials and budget      |
| Gemini Veo 3.0    | Async submit, poll, download                        | No identity-image reference mode                                                        | Capability validation tested                                                    | Pending credentials and budget      |
| Seedance Ark      | Async submit, poll, download                        | First-frame image only in this adapter; identity-reference series shots are blocked     | Task mapping and first-frame request tested                                     | Pending credentials and budget      |
| Custom async JSON | User-configured endpoints and field paths           | Profile-dependent; explicit capability declaration                                      | Declarative mapping, unknown outcomes and approved-origin transport tested      | Pending a specific provider profile |
| Gemini image      | Generate and edit portrait from approved references | Inline image references                                                                 | Adapter mapping tested                                                          | Pending credentials and budget      |
| OpenAI image      | Generate portrait from text                         | No image edit/reference in this adapter                                                 | Adapter mapping tested                                                          | Pending credentials and budget      |

The engine screen stores multiple video and image configurations independently. Credentials are kept out of exported configuration and project backups. If OS secure storage is unavailable, credentials are session-only. The local fake adapters are test fixtures and are absent from the production engine selector.

Provider references: [Veo API](https://ai.google.dev/gemini-api/docs/video), [Seedance Ark](https://www.volcengine.com/docs/82379/1366799). The exact account contract must be checked before turning on paid generation.
