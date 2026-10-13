# Video creation acceptance — 2026-10-14

Implementation branch: `codex/video-creation`. This is a desktop feature for creating new videos and series; remake of an existing video is a later scope.

| Requirement                                                | Evidence                                                                                                                                                     | Status              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| Configurable video engines in the existing Engine screen   | Provider settings, credentials and dedicated video UI; adapter and panel tests                                                                               | Implemented offline |
| Story discovery using the Superpowers brainstorming method | One-question discovery, fact/suggestion provenance, editable brief and explicit confirmation; source revision recorded in `creative-discovery-provenance.md` | Implemented offline |
| Complete script and extracted cast                         | Structured script steps, scene/dialogue validation, explicit cast linking                                                                                    | Implemented offline |
| Stable character across a series                           | Stable ID, revisions, approved images, voice assignment, snapshot bindings; acceptance test adds episode 2 with same character                               | Implemented offline |
| Generate or upload reference images                        | Gemini/OpenAI image adapters, local import, approval and content hashing                                                                                     | Implemented offline |
| Video generation, cost approval and take review            | Provider adapters, quote, budget ledger, durable jobs, unknown-outcome reconciliation, chosen take                                                           | Implemented offline |
| Export and restore                                         | Real FFmpeg MP4 and SRT output, asset hashing, backup/restore checks                                                                                         | Implemented offline |

Offline verification:

- `npm run test:video-creation`: 53 tests passed after the final binding and subtitle changes.
- `npm run test:video-creation:e2e`: passed; fixture creates a reference image and MP4, then follows one series episode through shot approval, generation, take selection and export. It also checks that a revised character cannot silently reuse an outdated shot binding.
- Renderer video suites: five new suites passed. Existing provider lifecycle passed. Existing runtime import test passed in isolation after one timeout during a parallel test run.
- `npm run check:i18n` and `npm run test:work-item-durability`: passed.
- Dubbing ownership/deletion checks and three of four compose checks passed with `node --import tsx` because the `tsx` CLI cannot create an IPC pipe in this sandbox. The remaining compose-runner check uses existing `ffmpeg-static`; after substituting the installed FFmpeg binary, it reaches an assertion on different FFmpeg stderr wording. This is an environment-dependent existing test, outside the new feature.
- Main TypeScript check has four existing `BodyInit` type errors in ASR services (Aliyun, Deepgram, Tencent, Xfyun), with no video-creation type error. Renderer TypeScript check passed.
- `npm run build` passed after the final production changes. Prettier check and `git diff --check` passed.

Live acceptance is pending. No user API key or approved spending ceiling was available, so no paid generation was submitted. The next live gate is to configure one accessible video provider and one image provider, approve a small budget, create a short portrait and shot, verify the remote job and output quality, then record actual cost, latency, audio/identity continuity and region/model availability. The offline fake adapter does not establish those qualities.
