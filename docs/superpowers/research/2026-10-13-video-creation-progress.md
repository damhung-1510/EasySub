# Execution ledger — plan: docs/superpowers/plans/2026-10-13-video-creation.md

Branch: codex/video-creation; baseline main. User authorized branch and implementation 2026-10-13.

- Preserved existing renderer/context/NavigationGuardContext.tsx user diff; excluded from feature commits.
- Baseline: npm run test:work-item-durability PASS.
- Ruling: work in user-requested new branch in current checkout rather than a new worktree; minimizes relocation and preserves user's checkout access. Cost: shared working tree, mitigated by disjoint file ownership.
- Ruling: skill workflow implemented using native tools and durable ledger rather than downloading executable helper scripts. Cost: manual bookkeeping; no remote code execution.
- Ruling: combine adjacent tightly coupled tasks into domain/API/UI integration groups, with tests before implementation and independent review; interfaces pinned early. Cost: larger review ranges.
- Ruling: tsx CLI blocked by sandbox IPC listen; equivalent node --import tsx --test used.
- Assembly tests RED: timeline/assembly feature exports absent; 2 expected assertions failed.
- Environment: ffmpeg-static binary missing in existing node_modules. Existing @ffmpeg-installer/ffmpeg binary available; new assembly uses installed fallback, no download needed.
- Live API benchmarks pending user-provided keys and explicit budget. No credentials read or paid requests executed.
- Implemented domain, discovery, brief/script/cast, approved references, storyboard snapshots, configurable video/image adapters, credential handling, cost ledger, persistent async jobs, take review, FFmpeg export, subtitles, backup/restore and the Engine/Video Creation UI.
- Added a persistent creative authorization keyed by project, episode and writing provider; request counts survive restarts and require an explicit new budget session to reset. Added a character revision refresh path so new shots cannot silently use outdated identity bindings; old takes require an explicit keep-old choice.
- Offline acceptance exercises the service across reference import, storyboard, cost approval, fake video job, chosen take, MP4/SRT export and series reuse. Provider quality and actual billing remain live-pending.
- Build: `npm run build` passed after the final production changes. All 53 video backend tests passed; offline acceptance passed; renderer TypeScript and i18n passed. Main TypeScript still has four pre-existing ASR `BodyInit` errors, no new video module errors.
- Regression environment: `tsx` executable cannot open its IPC pipe in the sandbox; equivalent `node --import tsx` checks pass. Existing compose-runner check depends on a missing local `ffmpeg-static` binary, and with the installed fallback reaches a brittle FFmpeg stderr text assertion. These are separate from the new video export acceptance, which passes with real FFmpeg.
