# Video Creation & Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Xây dựng chức năng từ ý tưởng/kịch bản đến video, tự tạo hoặc tải ảnh nhân vật, giữ hồ sơ dùng chung cho series và xuất MP4.
**Architecture:** Project store độc lập quản lý nội dung/revisions/assets; WorkItem theo dõi jobs. Structured LLM tạo kịch bản/storyboard; image/video adapters xử lý API; main process giữ secret, điều phối ngân sách và FFmpeg; renderer chỉnh sửa và duyệt.
**Tech Stack:** TypeScript, Electron, Next.js/React, OpenAI-compatible transport hiện có, Node test runner qua tsx, Jest, FFmpeg hiện có. API ảnh/video chọn ở Task 01; không mặc định cài SDK.
**Spec:** ../specs/2026-10-13-video-creation-design.md
**Status:** Kế hoạch đã cập nhật yêu cầu Engine tạo Video và hội thoại Superpowers; chưa chạy task, chưa gọi API trả phí. Người dùng đã xác nhận tự tạo ảnh + upload; video dùng Veo 3 hoặc Seedance.
**Execution:** Chưa chọn native/subagent-driven; chỉ chọn khi bắt đầu triển khai.

## Global Constraints

- API settings phải ở trang Engine hiện có, section “Engine tạo Video”; màn sản xuất chỉ chọn provider/model và link về Engine.
- Trước tạo ảnh/video, workflow làm rõ ý tưởng dùng cách hỏi của Superpowers brainstorming, có tóm tắt và xác nhận draft; không tự tạo media trong hội thoại.
- Là chức năng tổng quát: phong cách/thời lượng/ngôn ngữ là cấu hình, không là kịch bản cố định.
- Bản đầu: một video adapter thực tế + một image adapter thực tế + fake adapters; video adapter thứ hai là extension riêng.
- BYOK/local-first; không upload khi chưa xác nhận phạm vi dữ liệu; không tự submit tác vụ trả phí khi chưa duyệt budget.
- Kịch bản gốc và revision đã duyệt bất biến; LLM JSON lỗi sửa tối đa 2 lần sau request đầu tiên.
- Character ID ổn định; shot pin script/cast/reference/style/location revisions; thay đổi không tự xóa hoặc tạo lại footage.
- Submit timeout chưa rõ kết quả → unknown; không tự retry. Quote không rõ giá phải hiển thị unknown, không coi là miễn phí.
- TTS/narration + phụ đề là đường xuất đảm bảo; native dialogue cần review. Lip-sync riêng và remake ngoài đợt này.
- Không sửa hoặc đưa vào commit thay đổi có sẵn của người dùng tại renderer/context/NavigationGuardContext.tsx.
- Runtime main không phụ thuộc Electron trong domain/test modules; Electron chỉ ở composition root/IPC/credential wrapper.
- Mọi tiền lưu integer minor units + currency; không tự chuyển đổi tiền tệ, không so tổng các currency khác nhau.
- UI defaults đề xuất: tiếng Việt, 16:9, mục tiêu 60 giây, narration, xuất 1080p/24fps; đều sửa được. Thời lượng xuất thực tế có thể khác mục tiêu, luôn hiển thị chênh lệch.
- Input/output phải giới hạn theo capability; không âm thầm bỏ ảnh hoặc cắt lời thoại.

## Review Focus

1. Crash giữa submit và lưu remote ID: không tự phát lại; giữ budget reservation và unknown để đối soát (Task 15).
2. Chỉnh script/cast khi request đang chạy: output thuộc revision cũ; không thành take hiện hành ngầm (Task 08, 16).
3. Cùng tên nhưng khác người / đổi tên giữa tập: liên kết bằng ID, xác nhận gộp, giữ speaker references (Task 07).
4. Giá chưa biết / currency khác / image retries: không cộng sai hoặc vượt hạn mức batch (Task 14).
5. Ý tưởng sơ sài hoặc yêu cầu tự đề xuất: hỏi trọng tâm, không lặp vô hạn, không biến assumptions thành canon hoặc tạo media trước duyệt (Task06A).
6. Custom provider có API khác chuẩn: profile rõ, validation và lỗi có thể sửa, không coi URL+key là tự tương thích (Task12A).
7. Export fps khác nhau, lời thoại dài hoặc thiếu ảnh: fail có hành động sửa; không xuất video cắt lời hoặc thiếu shot (Task 10, 17, 18).

## Những điểm đã khảo sát trong source

- main/assistant/provider.ts requestAssistant(provider, messages, tools, signal, onText) trả ModelReply; dùng transport qua wrapper tools=[]; không dùng chat session làm store.
- main/helpers/atomicFile.ts có atomicReplaceTextFile; tái sử dụng cho manifest.
- main/helpers/storagePaths.ts có resolveStorageLocation; gọi với subpath ['video-projects'], không mở rộng StorageKind chuyên model.
- main/background.ts là composition root đăng ký handlers/lifecycle; đăng ký module mới tại đây, không cần nhét vào ipcHandlers.ts.
- main/preload.ts có generic window.ipc.invoke/on; wrapper renderer typed đủ dùng, không cần thêm bridge nếu không có capability mới.
- Jest hiện chỉ match renderer và main/service; domain backend dùng npx tsx --test scripts/videoCreation/*.test.ts, không âm thầm đặt test ở thư mục Jest bỏ qua.
- WorkItemType chưa có videoCreation; renderer/lib/taskTypes.ts chỉ dành pipeline ASR/translation, không thêm video vào TASK_TYPES.
- runComposeJob(config, ctx) nhận một videoPath; phải assembly nhiều shots trước.
- Engine hiện có renderer/pages/[locale]/engines.tsx → EngineModelTab.tsx, views tại renderer/lib/engineViews.ts; thêm nhóm video riêng, không đổi TranscriptionEngine.
- locales đang có vi/en/zh; thêm đủ ba bộ keys.

## Contract chung (Task 02 định nghĩa đầy đủ)

ID/revision là string UUID. Project {id, kind:'single'|'series', schemaVersion:1, version:number, episodes, characters, locations, props, styles, canon, assets, discoverySessions, confirmedBriefRevisions}. Mỗi entity có revisionId và approvedAt tùy chọn. Script {scenes:Scene[]}; Scene chứa dialogues {id,speakerId,text,emotion}, action/narration/sound/duration. ShotSnapshot chứa briefRevisionId, scriptRevisionId, sceneId, characterBindings, locationRevisionId, styleRevisionId, prompt, durationMs, audioMode. Attempt lưu snapshotHash, providerId/modelId, providerConfigRevisionId, remoteJobId?, trạng thái, artifacts và ledgerReservationId. Provider metadata có protocolProfileId/revision và verifiedAt tùy chọn; cập nhật config không đổi URL/model của active job ngầm.

Store mutate dùng optimistic concurrency expectedVersion; approved snapshots immutable. API Result<T> = {ok:true,value:T}|{ok:false,error:{code,message,retryable}}. Metadata/DTO không có secrets hoặc signed URLs.

Provider contract trong types/videoProvider.ts:

- VideoAdapter.capabilities(): VideoCapabilities
- VideoAdapter.quote(request: VideoRequest, signal: AbortSignal): Promise<CostQuote>
- VideoAdapter.submit(request: VideoRequest, signal: AbortSignal): Promise<RemoteJob>
- VideoAdapter.poll(remoteId: string, signal: AbortSignal): Promise<RemoteJob>
- VideoAdapter.cancel?(remoteId: string, signal: AbortSignal): Promise<CancelResult>
- VideoAdapter.download(job: RemoteJob, destination: string, signal: AbortSignal): Promise<MediaAsset>
  ImageAdapter tương tự nhưng generate(request,signal):Promise<ImageResult>; timeout cũng có outcome:'unknown'. ImageRequest có references và requestId.
  CostQuote {currency, maxMinor?:number, confidence:'exact'|'upperBound'|'estimate'|'unknown', capturedAt, components}.
  Tất cả IO được inject để unit tests không gọi mạng.

## Thứ tự và checkpoints

01 khảo sát/benchmark chuẩn bị → 02–05 foundation → 06–11 script/cast/images/storyboard → 12–16 video jobs → 17–19 assembly/UI → 20–22 acceptance/backup/release.
Task 01 có hai phần: khảo sát offline trước; live benchmark sau Task 05 với key/hạn mức được xác nhận. Harness01 dùng transport thử nghiệm qua official endpoint trong matrix; không cần adapter production13 có trước. Payload/protocol đo được chuyển thành fixtures cho13. Nếu chưa có key, chọn adapter tạm theo offline matrix rồi hoàn tất live01 trước khi accept13. Task 13 không hoàn thành nếu chưa có live smoke. Task 09 không hoàn thành nếu chỉ có fake ảnh. Có thể làm task độc lập trong lúc chờ credentials, nhưng không công bố chức năng hoàn chỉnh khi chưa có adapter thực tế.

## Task 01: Khảo sát API và chốt provider bằng bằng chứng

**Phụ thuộc:** Không phụ thuộc.
**Files — Create:** docs/superpowers/research/2026-10-13-video-provider-matrix.md; scripts/videoCreation/benchmark.ts; scripts/videoCreation/fixtures/benchmark.json.
**Files — Modify:** types/videoProvider.ts (chỉ sau Task 02).
**Tests:** scripts/videoCreation/benchmark.test.ts.
**Interfaces:** `runBenchmark(adapter: VideoAdapter, cases: BenchmarkCase[], authorization: BenchmarkAuthorization): Promise<BenchmarkReport>`.
**Deliverable:** offline matrix Veo 3/3.1 và Seedance theo endpoint/model/account; API ảnh ứng viên Gemini image hoặc Seedream. Báo access, refs, duration, audio, uploads, retention, pricing. Không coi BytePlus và Volcengine là cùng một endpoint. Live harness chạy sau 05, đánh giá một/hai nhân vật, góc máy, hai tập, refs quá giới hạn; người dùng chấm accept/reject từng take.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(fake.submitCalls, 0); // thiếu authorization không có submit
assert.equal(report.cases.length, 6); // 6 lớp benchmark cố định
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/benchmark.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Không có key/budget thì report ghi live-pending, không fake quality. Chọn đúng một video + một image model đã truy cập được; model IDs và capability fixture pin vào report.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 01 Khảo sát API và chốt provider bằng bằng chứng` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 02: Domain schema và hợp đồng adapters

**Phụ thuộc:** 01 offline.
**Files — Create:** types/videoProject.ts; types/videoProvider.ts; types/videoCreationIpc.ts; main/videoCreation/schemas.ts; scripts/videoCreation/fixtures/project.ts.
**Files — Modify:** package.json.
**Tests:** scripts/videoCreation/schema.test.ts.
**Interfaces:** `parseVideoProject(raw: unknown): VideoProject; validateShot(snapshot: ShotSnapshot, project: VideoProject): ValidationIssue[]`.
**Deliverable:** Định nghĩa đủ types trong contract chung; dùng validators TypeScript hiện có, không thêm schema lib bắt buộc. UUID string và relations có kiểm tra. Asset lưu path tương đối thuộc project. State discriminated unions; credentials không thuộc project. Thêm script test:video-creation = tsx --test scripts/videoCreation/*.test.ts.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.throws(
  () => parseVideoProject({ ...project, schemaVersion: 99 }),
  /UNSUPPORTED_SCHEMA/,
);
assert.equal(
  validateShot(unknownSpeakerShot, project)[0].code,
  'UNKNOWN_CHARACTER',
);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/schema.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Fixtures đủ scene/dialogue/character/shot/attempt; exports được consumers import đúng tên, không any ở contract.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 02 Domain schema và hợp đồng adapters` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 03: Project store, revision và chống ghi đè

**Phụ thuộc:** 02.
**Files — Create:** main/videoCreation/projectStore.ts; main/videoCreation/revisions.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/projectStore.test.ts.
**Interfaces:** `createProjectStore(root: string): ProjectStore; ProjectStore.create(input: ProjectDraft): Promise<VideoProject>; load(id:string):Promise<VideoProject>; update(id:string, expectedVersion:number, mutate:(p:VideoProject)=>VideoProject):Promise<VideoProject>; list():Promise<ProjectSummary[]>`.
**Deliverable:** Root theo resolveStorageLocation subpath video-projects; dùng atomicReplaceTextFile, serialize writes từng project, expectedVersion CAS. Không ghi approved revision tại chỗ. Startup khôi phục last-good manifest hoặc lỗi recoverable, giữ file hỏng phục vụ sửa. Không scan/load mọi footage khi list.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal((await store.load(id)).version, 2);
await assert.rejects(store.update(id, 1, mutate), /VERSION_CONFLICT/);
assert.deepEqual(afterFailedRename, before);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/projectStore.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Restart còn draft và revisions; concurrent writes không mất cập nhật; Windows rename failure không phá manifest.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 03 Project store, revision và chống ghi đè` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 04: Assets và upload ảnh chuẩn

**Phụ thuộc:** 03.
**Files — Create:** main/videoCreation/assetStore.ts; main/videoCreation/mediaProbe.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/assetStore.test.ts.
**Interfaces:** `importReference(projectId:string, sourcePath:string, signal:AbortSignal):Promise<MediaAsset>; validateMedia(path:string, kind:'image'|'video'):Promise<MediaInfo>`.
**Deliverable:** Chỉ nhận PNG/JPEG/WebP đã kiểm magic/decode; mặc định ảnh <=20MiB, tổng pixels <=40MP là giới hạn app có lỗi rõ. Copy vào assets content-addressed SHA256; không chỉ lưu đường dẫn nguồn. Probe dùng FFmpeg hiện có, không giả định có ffprobe. Cấm escape project qua relative path/symlink.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(asset1.sha256, asset2.sha256);
await assert.rejects(importBadMagic(), /INVALID_IMAGE/);
assert.equal(await exists(sourcePath), true);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/assetStore.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Xóa ảnh nguồn không làm mất reference; file quá lớn và path traversal bị từ chối; cancel dọn partial.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 04 Assets và upload ảnh chuẩn` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 05: Provider settings và secret storage

**Phụ thuộc:** 02,03.
**Files — Create:** main/videoCreation/credentialStore.ts; main/videoCreation/providerSettings.ts; main/videoCreation/transport.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/credentials.test.ts.
**Interfaces:** `saveProviderConfig(config:ProviderConfig, secret?:string):Promise<ProviderPublicConfig>; getProviderSecret(id:string):Promise<string>; createTransport(config:ProviderConfig):ProviderTransport`.
**Deliverable:** safeStorage wrapper ở main; lưu encrypted secret file riêng. Encryption unavailable thì cho session-only, không fallback plaintext. DTO chỉ hasCredential. Transport inject HTTP, honor proxy hiện có; Official preset URLs hoặc endpoint custom người dùng cấu hình rõ; HTTPS mặc định, HTTP chỉ localhost explicit; redirect kiểm lại, không forward auth sang origin khác; redact headers/signed query. Key do user nhập chỉ truyền one-way tới main, không giữ trong form sau save.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(JSON.stringify(publicConfig).includes(secret), false);
assert.equal(unavailableStorage.persistedBytes, 0);
assert.equal(redactedLog.includes(secret), false);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/credentials.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Không ảnh hưởng cách lưu provider ASR/translation cũ. Hoàn thành task mở đường live benchmark 01.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 05 Provider settings và secret storage` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 06: Workflow LLM kịch bản có cấu trúc

**Phụ thuộc:** 02,03,06A contracts.
**Files — Create:** main/videoCreation/llmAdapter.ts; main/videoCreation/scriptWorkflow.ts; main/videoCreation/prompts/script.ts; main/videoCreation/contextBuilder.ts.
**Files — Modify:** Không; tái sử dụng main/assistant/provider.ts qua wrapper.
**Tests:** scripts/videoCreation/scriptWorkflow.test.ts.
**Interfaces:** `runScriptStep(input:ScriptStepInput, deps:ScriptDeps, signal:AbortSignal):Promise<ScriptStepResult>; buildScriptContext(project:VideoProject, episodeId:string, maxCharacters:number):ScriptContext`.
**Deliverable:** Steps brief/outline/script/import-analysis/review; đầu vào là confirmed creative brief từ06A, hoặc script sẵn đã import và review gaps; wrapper requestAssistant tools=[] không chạy tool calls. Parse/schema validate từng step, repair tối đa 2, stop khi cancel hoặc response incomplete. Dựng cảnh/lời thoại có speaker candidate trước cast confirmation. Truy xuất canon/characters liên quan; context quá lớn báo cần split, không cắt mất ràng buộc. Preserve imported text; generation tạo draft revision mới.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(invalidThenRepairs.requests, 3);
assert.equal(originalText, projectAfter.originalScriptText);
assert.equal(reviewResult.approvedRevisionChanged, false);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/scriptWorkflow.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; LLM không có native JSON vẫn dùng parse+schema; file .txt UTF-8 hoặc dán text; không hỗ trợ DOCX/PDF trong bản đầu. Mỗi step ghi usage vào cost boundary Task 14 sau.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 06 Workflow LLM kịch bản có cấu trúc` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 06A: Làm rõ ý tưởng theo Superpowers trước sản xuất

**Phụ thuộc:** 02,03,05,14. Định nghĩa LLM adapter contract trước; production transport dùng wrapper requestAssistant như06, không phụ thuộc scriptWorkflow06.
**Create:** types/creativeDiscovery.ts; main/videoCreation/discovery/{workflow,readiness,context,prompt}.ts; docs/superpowers/research/creative-discovery-provenance.md.
**Modify:** main/videoCreation/schemas.ts; types/videoCreationIpc.ts; main/videoCreation/projectStore.ts.
**Test:** scripts/videoCreation/discovery.test.ts.
**Interfaces:** `startDiscovery(input:DiscoveryInput,deps:DiscoveryDeps,signal:AbortSignal):Promise<DiscoverySession>`; `answerDiscovery(sessionId:string,answer:DiscoveryAnswer,expectedVersion:number):Promise<DiscoveryTurn>`; `suggestRemaining(sessionId:string,signal:AbortSignal):Promise<CreativeBriefDraft>`; `confirmBrief(sessionId:string,draftRevisionId:string,expectedVersion:number):Promise<ConfirmedCreativeBrief>`; `evaluateCreativeReadiness(brief:CreativeBriefDraft):CreativeReadiness`.

**Contract:** DiscoverySession lưu projectId/episodeId, inputText, turns, decisions, currentQuestion, draftRevision, status và usage. CreativeDecision có field/value, source:'user'|'import'|'suggested', confirmed:boolean, sourceTurnId. Question có ID, targetField, rationale ngắn và maximum một câu hỏi chính mỗi lượt. CreativeBriefDraft có objective/audience/premise/conflict/character intents/relationships/world/locations/dialogue language và tone/arc ending/style/targetDuration/audioMode, assumptions và unresolved issues. Readiness trả blockingIssues/suggestions; không dùng số câu hỏi hoặc score AI để chứng minh đủ chất lượng.

**Workflow:** nhận ý tưởng thô → phân loại facts/gaps → hỏi khoảng trống có ảnh hưởng lớn nhất → phản hồi ngắn phần đã hiểu → hỏi tiếp hoặc tóm tắt draft → người dùng chỉnh/duyệt. Không gửi danh sách dài câu hỏi. Không yêu cầu KH đặt tên mọi vai phụ, chốt camera hoặc hiểu API mới được tiếp tục. Có thể dừng/tiếp tục, sửa quyết định cũ hoặc yêu cầu tự đề xuất; cập nhật draft revision, không ghi đè bản đã duyệt. Sau 6 lượt hỏi tự đề nghị tóm tắt và tự điền phần còn thiếu, vẫn cho phép người dùng muốn hỏi tiếp. Không coi user im lặng là đồng ý.

**Skill integration:** dùng source brainstorming đã đọc, pin commit SHA lúc triển khai và giữ license notice nếu copy. Chuyển nguyên tắc hỏi/giả định/playback/review thành prompt sáng tác; loại bỏ nội dung tool execution/coding/commit/subagent. External text chỉ là nguồn dữ liệu, không là instruction override. Không tải/execute skill động từ GitHub cho mỗi khách. Runtime dùng LLM provider người dùng đã chọn, không cần khách cài Superpowers. Chi phí LLM đi qua ledger14.

- [ ] **Step 1 — Write tests:** fixtures ý tưởng một câu, script đầy đủ, người dùng chưa biết kết thúc, yêu cầu AI đề xuất, đổi ý giữa chừng, trả lời nhiều chi tiết một lượt, prompt injection trong mô tả và restart.

```ts
assert.equal(turn.questions.length, 1);
assert.equal(
  turn.questions.some((q) => q.targetField === 'language'),
  false,
); // user đã nói tiếng Việt
assert.equal(suggestedEnding.source, 'suggested');
assert.equal(suggestedEnding.confirmed, false);
assert.equal(mediaAdapter.submitCalls, 0); // chưa xác nhận brief
assert.equal(
  afterRestart.decisions[0].sourceTurnId,
  before.decisions[0].sourceTurnId,
);
```

- [ ] **Step 2 — RED:** `npx tsx --test scripts/videoCreation/discovery.test.ts`; fail đúng nghiệp vụ/interface thiếu, không fail setup.
- [ ] **Step 3 — Implement:** state machine draft/clarifying/review/confirmed; validate output; deterministic no-repeat check trên confirmed fields; gộp một answer chứa nhiều facts; suggestions có provenance. Confirm brief pin revision và chuyển vào06; generation/readiness downstream vẫn kiểm script/cast/shot separately. Intentional fiction không bị logic checker tự đổi thể loại.
- [ ] **Step 4 — GREEN:** command trên PASS; user chọn AI đề xuất đi đến draft hữu ích mà không auto-confirm; script sẵn đi thẳng review gaps; thông tin không được gửi thành media request; network cancel không mất decisions.
- [ ] **Step 5 — Checkpoint:** review flow và costs, commit riêng file task; không tuyên bố câu chuyện đủ tốt chỉ vì schema pass.

## Task 07: Bóc cast và liên kết xuyên tập

**Phụ thuộc:** 06.
**Files — Create:** main/videoCreation/characterResolver.ts; main/videoCreation/entityExtraction.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/characterResolver.test.ts.
**Interfaces:** `extractEntities(script:ScriptRevision, deps:ScriptDeps, signal:AbortSignal):Promise<EntityCandidates>; proposeCharacterLinks(candidates:CharacterCandidate[], project:VideoProject):LinkProposal[]; applyCharacterLinks(project:VideoProject, decisions:LinkDecision[]):VideoProject`.
**Deliverable:** Extract characters/locations/props, annotate inferred/sourceSceneIds. Candidate names/aliases chỉ đề xuất links; chỉ decision xác nhận mới gộp. Mapping speaker candidates sang stable IDs sau confirmation. Rename giữ ID. Identity/appearance variants/episode states tách schemas.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(
  proposeCharacterLinks(sameNamePeople, project)[0].needsConfirmation,
  true,
);
assert.equal(renamed.characterId, before.characterId);
assert.equal(script.dialogues[0].speakerId, stableId);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/characterResolver.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Hai tập dùng cùng ID; không tự tạo duplicate khi alias được xác nhận; undefined speaker không được approve.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 07 Bóc cast và liên kết xuyên tập` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 08: Continuity, canon và dependency revisions

**Phụ thuộc:** 07.
**Files — Create:** main/videoCreation/continuityValidator.ts; main/videoCreation/dependencies.ts; main/videoCreation/canon.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/continuity.test.ts.
**Interfaces:** `validateContinuity(project:VideoProject, episodeId:string):ContinuityIssue[]; affectedShots(project:VideoProject, changed:RevisionRef[]):string[]; acceptCanonDelta(project:VideoProject, delta:CanonDelta, expectedVersion:number):VideoProject`.
**Deliverable:** Track script/cast/style/location/prop dependencies theo hash. Canon có episodeOrder/effectiveFrom; tập 2 không thấy spoiler tập 5. Canon chỉ từ approved script và explicit accept. Sửa draft chưa pin không invalidate shot cũ; migrate selected shots tạo snapshots mới và stale selected result; active attempt giữ snapshot cũ.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(
  contextEpisode2.canon.some((e) => e.episodeOrder === 5),
  false,
);
assert.equal(oldShot.characterRevisionId, oldRevision);
assert.deepEqual(affectedShots(project, [changedRef]), ['shot-a']);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/continuity.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Continuity issues có severity/action và source scene; LLM review bổ trợ, không tự sửa canon.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 08 Continuity, canon và dependency revisions` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 09: Image adapter và tự tạo nhân vật

**Phụ thuộc:** 04,05,07,14; 01 image selection.
**Files — Create:** main/videoCreation/imageWorkflow.ts; main/videoCreation/providers/imageProvider.ts; main/videoCreation/providers/fakeImage.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/imageWorkflow.test.ts.
**Interfaces:** `generateCharacterReference(input:CharacterImageInput, deps:ImageWorkflowDeps, signal:AbortSignal):Promise<ReferenceCandidate>; approveReference(project:VideoProject, candidateId:string):VideoProject`.
**Deliverable:** API ảnh/model chốt từ 01; facade stable file imageProvider.ts. Text-to-image cho portrait đầu; người dùng duyệt portrait; generate full-body/profile/variant nhận approved portrait reference. Adapter không hỗ trợ image reference thì block góc bổ sung, không tạo lại text-only ngầm. Candidate lưu local và usage; approve không auto approve ảnh khác. Batch generation kiểm budget riêng.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(nextView.request.referenceAssetIds[0], approvedPortrait.id);
assert.equal(unreviewedCandidate.approvedAt, undefined);
assert.equal(noReferenceAdapter.submitCalls, 0);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/imageWorkflow.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Có live smoke text→portrait và portrait→góc khác bằng tài khoản được chọn, file ảnh hợp lệ. Unknown submit không tự retry; ảnh người dùng upload vẫn hoạt động độc lập.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 09 Image adapter và tự tạo nhân vật` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 10: Storyboard và prompt compiler

**Phụ thuộc:** 08,09,12.
**Files — Create:** main/videoCreation/storyboardWorkflow.ts; main/videoCreation/promptCompiler.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/storyboard.test.ts.
**Interfaces:** `buildStoryboard(input:StoryboardInput, deps:ScriptDeps, signal:AbortSignal):Promise<ShotDraft[]>; compileVideoRequest(shot:ShotSnapshot, project:VideoProject, capabilities:VideoCapabilities):VideoRequest`.
**Deliverable:** Split scene thành shots theo durations/capabilities cụ thể, không hard-code shot 5s cho mọi provider. Prompt thể hiện identity/action/camera/environment/audio; deterministic normalized fingerprint. Pin refs từng nhân vật và giới hạn combined refs. Vượt refs cho người dùng chọn thay storyboard/reference arrangement, không drop. Tổng durations so với target và cảnh báo; chưa duyệt không submit.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(compile(twoPeopleShot).references.length, 2);
assert.throws(() => compile(overReferenceLimit), /REFERENCE_LIMIT/);
assert.equal(hash(requestA), hash(requestB));
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/storyboard.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Model Veo family phân biệt first-frame và reference-image. Duration mismatch, unknown speaker/location, missing approved ref chặn ready.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 10 Storyboard và prompt compiler` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 11: UI dự án, script, cast và ảnh

**Phụ thuộc:** 03–10,06A,11A,19 IPC foundation.
**Files — Create:** renderer/pages/[locale]/videoCreation.tsx; renderer/lib/videoCreationClient.ts; renderer/components/videoCreation/{ProjectList,EpisodeEditor,ScriptEditor,CharacterLibrary,ReferenceEditor,StoryboardEditor,CreativeDiscoveryPanel}.tsx; renderer/public/locales/{vi,en,zh}/videoCreation.json.
**Files — Modify:** renderer/components/Layout.tsx; renderer/public/locales/{vi,en,zh}/common.json.
**Tests:** renderer/components/**tests**/VideoCreationEditor.test.tsx.
**Interfaces:** `VideoCreationClient.call<K extends VideoCommand>(command:K,payload:VideoCommandInput[K]):Promise<VideoCommandOutput[K]>; components nhận projectId/episodeId qua route query`.
**Deliverable:** Tab workflow có save draft/CAS conflict message; original script import và rewrite buttons riêng. Cast edit/confirm/refs generator/upload; có feedback candidate chưa duyệt. CreativeDiscoveryPanel có hội thoại một câu mỗi lượt, tóm tắt assumptions và nút “AI đề xuất phần còn thiếu”; selector video/image/LLM dùng provider đã cấu hình. Không có form API key trên trang sản xuất; nút “Cấu hình Engine” dẫn về section11A. Navigation thêm mục mới và namespace i18n. Không làm lại NavigationGuardContext; dùng API guard hiện có nếu cần.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
expect(screen.getByText('Bản gốc')).toHaveTextContent(importedText);
expect(generateButton).toBeDisabled(); // cast chưa duyệt
expect(client.save).toHaveBeenCalledWith(
  expect.objectContaining({ expectedVersion: 3 }),
);
```

- [ ] **Step 2 — Xác nhận RED:** backend: `npx tsx --test scripts/videoCreation/*.test.ts`; renderer: `npx jest --runInBand --runTestsByPath renderer/components/__tests__/VideoCreationEditor.test.tsx`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Mở lại episode đúng draft; rename character không mất dialogue bindings; đủ vi/en/zh keys.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 11 UI dự án, script, cast và ảnh` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 11A: Section “Engine tạo Video” và tùy chỉnh provider

**Phụ thuộc:** 05,12A contracts,19A. Không phụ thuộc UI production11; triển khai trước11.
**Create:** renderer/components/resources/engines/panels/VideoProviderPanel.tsx; renderer/components/resources/engines/panels/VideoProviderForm.tsx; renderer/hooks/useVideoProviders.ts.
**Modify:** renderer/components/resources/EngineModelTab.tsx; renderer/components/resources/engines/EngineOverviewPanel.tsx; renderer/lib/engineViews.ts; renderer/pages/[locale]/engines.tsx; renderer/public/locales/{vi,en,zh}/resources.json.
**Tests:** renderer/components/**tests**/VideoEngineProviders.test.tsx; scripts/videoCreation/providerSettings.test.ts.
**Interfaces:** `useVideoProviders():VideoProviderHook`; `VideoProviderPanel({selectedProviderId,onSelect}:VideoProviderPanelProps)`; `saveProviderDraft(draft:ProviderDraft,expectedVersion:number):Promise<ProviderPublicConfig>` (main05 mở rộng validation).

**UI:** thêm nhóm đúng nhãn “Engine tạo Video” ở cột trái EngineModelTab. Trong nhóm có tổng quan và các instance Veo/Seedance/custom; nhóm phụ ảnh nhân vật dùng image adapter. Không đặt config vào TTS services, không đổi ASR selected engine. IDs video:overview/video:provider:<id>/video:images được engineViews validate, migrate selected view đã lưu; xóa instance đang selected chuyển video:overview. Bảng tổng quan phân biệt configured/verified/unverified/error, không suy ready chỉ vì có key.

**Fields:** tên, protocol profile, API base URL, auth mode/key hoặc supported header name, model/model version, text/image/reference capabilities và supported durations/ratios/resolution, timeout/concurrency, pricing override currency/unit/source/date. Có preset Veo và Seedance, clone instance, import/export metadata không secret, nút read-only connection test nếu endpoint có. Không test connection bằng tạo video ngầm; nếu API chỉ hỗ trợ generation để verify thì hiển thị chưa kiểm chứng và đường test clip có quote/approval riêng.

- [ ] **Step 1 — Write tests:** thêm custom instance, save CAS failure giữ draft, 2 instances cùng hãng khác model, key không hiển thị lại, remove active selection, roundtrip config không secret, chọn video section không đổi ASR/GPU preferences.

```ts
expect(screen.getByText('Engine tạo Video')).toBeVisible();
expect(exportedConfig).not.toHaveProperty('apiKey');
expect(asrSettings.selectedEngine).toBe(beforeAsrSettings.selectedEngine);
expect(videoReadyLabel).not.toHaveTextContent('Đã kiểm chứng'); // chỉ có key
```

- [ ] **Step 2 — RED:** `npx jest --runInBand --runTestsByPath renderer/components/__tests__/VideoEngineProviders.test.tsx`; `npx tsx --test scripts/videoCreation/providerSettings.test.ts`.
- [ ] **Step 3 — Implement:** hook typed invoke cùng event unsubscribe/version handling; mới instance không bật/default ngầm. Extend engine view validation và group renderer riêng, không convert thành TranscriptionEngine. Add locale keys; production11 chỉ chọn config này và link query đến section. Delete provider có jobs pin config revision thì archive cho job cũ, không destroy credential cần poll/download mà không cảnh báo.
- [ ] **Step 4 — GREEN:** hai commands PASS; reload Engine vẫn có config/selected view; `npm run check:i18n` PASS; không regression ASR cloud provider forms.
- [ ] **Step 5 — Checkpoint:** review diff giới hạn Engine integration và commit.

## Task 12: Video registry và fake adapter

**Phụ thuộc:** 02,05,12A contracts.
**Files — Create:** main/videoCreation/providerRegistry.ts; main/videoCreation/providers/fakeVideo.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/providerRegistry.test.ts.
**Interfaces:** `createVideoRegistry(configs:ProviderConfig[], transport:TransportFactory):VideoRegistry; VideoRegistry.get(id:string):VideoAdapter`.
**Deliverable:** Capability lookup theo exact provider/model version, configurable account concurrency. Fake deterministic queued/running/completed/429/unknown/cancelUnsupported; fixture footage tạo local FFmpeg ở test setup. Registry reject unsupported models, không fallback provider ngầm.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.throws(() => registry.get('missing'), /PROVIDER_NOT_FOUND/);
assert.equal(fake.capabilities().cancel, false);
assert.equal((await fake.poll(job.id, signal)).state, 'completed');
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/providerRegistry.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Custom profiles dùng12A; profile không tương thích báo rõ, không fallback. Không có secret trong capability response; fake không được bật production như dịch vụ miễn phí.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 12 Video registry và fake adapter` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 12A: Custom provider profiles và mapping API khai báo

**Phụ thuộc:** 02,05. Định nghĩa contracts trước12 và11A.
**Create:** types/videoProviderProfile.ts; main/videoCreation/providers/customProfile.ts; main/videoCreation/providers/profileValidation.ts; scripts/videoCreation/fixtures/custom-profiles.json.
**Modify:** types/videoProvider.ts; main/videoCreation/providerSettings.ts; main/videoCreation/providerRegistry.ts khi12 sẵn sàng.
**Tests:** scripts/videoCreation/customProfile.test.ts.
**Interfaces:** `validateProviderProfile(raw:unknown):ProviderProtocolProfile`; `createCustomAdapter(config:ProviderConfig,profile:ProviderProtocolProfile,transport:ProviderTransport):VideoAdapter`.

**Profiles:** protocol 'veo-gemini'/'seedance-ark'/'custom-async-json'; không giả định arbitrary service tương thích chỉ nhờ baseURL/key. Config có endpoint paths submit/poll/cancel(optional), HTTP method theo allowlist, request body template JSON, response field paths jobId/status/result URL/error/usage và status value mapping. Placeholder whitelist: model,prompt,durationSeconds,aspectRatio,resolution,references,remoteJobId; auth do credentialStore/transport thêm, không chứa secret trong template. Dùng path resolver đơn giản và JSON value substitution, không eval/JS/shell/JQ runtime. Custom image provider ban đầu phải dùng protocol image đã hỗ trợ; API ảnh khác protocol không báo usable giả.

**Validation:** path phải tương đối baseURL, mọi redirects/downstream asset origins được kiểm theo upload/download policy; không forward credential tới host khác. Body bounded <=1MiB excluding uploaded binary, depth<=20; require mapping jobId/status/output và transitions. Poll là reads; custom POST submit timeout không auto retry. Capabilities do user khai báo được đánh dấu unverified cho đến contract/live check, không vượt model restrictions trong official profile. Request builder bảo vệ snapshot IDs/references; custom params không được override immutable binding.

- [ ] **Step 1 — Write tests:** compatible proxy baseURL; nested custom jobId/output; invalid status map; refs input; malicious placeholder/code; redirect cross-origin; unsupported image profile; timeout unknown.

```ts
assert.equal(customMappedJob.id, 'remote-123');
assert.equal(request.references.length, pinnedReferenceCount);
assert.throws(() => validateProviderProfile(codeTemplate), /INVALID_PROFILE/);
assert.equal(crossOriginRequest.headers.authorization, undefined);
assert.equal(timeoutOutcome, 'unknown');
```

- [ ] **Step 2 — RED:** `npx tsx --test scripts/videoCreation/customProfile.test.ts`.
- [ ] **Step 3 — Implement:** declarative mapping facade, typed errors PROFILE_INVALID/RESPONSE_MAPPING_FAILED/CAPABILITY_UNVERIFIED. Provide dry-run request preview redacted, map fixture response locally without network. Official profiles adapter13 implement riêng; custom profile có đủ contract mới usable, còn profile incomplete giữ draft.
- [ ] **Step 4 — GREEN:** tests PASS; fake custom async endpoint chạy submit→poll→download; test lỗi field mapping đưa message có field path, không lộ auth. Không advertise hỗ trợ mọi API ngoài.
- [ ] **Step 5 — Checkpoint:** review config roundtrip/redaction/adapter contract và commit.

## Task 13: Adapter video thực tế Veo hoặc Seedance

**Phụ thuộc:** 01 live,05,12.
**Files — Create:** main/videoCreation/providers/primaryVideo.ts; scripts/videoCreation/fixtures/provider-contract.json.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/videoProviderContract.test.ts.
**Interfaces:** `createPrimaryVideoAdapter(config:ProviderConfig, transport:ProviderTransport):VideoAdapter`.
**Deliverable:** Thực hiện đúng official API của provider đã chọn ở 01; poll operation/task ID, typed errors, retry-after cho reads. Upload reference bằng official mechanism hỗ trợ local bytes/upload; nếu cần hosted URL dùng approved upload flow, không public local file server. Quote exact/estimate/unknown từ price snapshot. Cancel unsupported trả typed unsupported. Download authenticated khi cần, không đưa URL signed về renderer.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(contract.request.model, configuredModel);
assert.equal(mappedBlockedError.code, 'CONTENT_BLOCKED');
assert.equal(authenticatedDownload.headerContainsKey, true);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/videoProviderContract.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Offline contract fixtures + một live smoke đã lưu metadata/usage/redacted request và local MP4 hợp lệ; không bắt buộc API thứ hai trong bản đầu.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 13 Adapter video thực tế Veo hoặc Seedance` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 14: Ledger và duyệt ngân sách

**Phụ thuộc:** 02,03.
**Files — Create:** main/videoCreation/budgetLedger.ts; main/videoCreation/costApproval.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/budgetLedger.test.ts.
**Interfaces:** `reserveCost(projectId:string, approval:CostApproval, quote:CostQuote, requestId:string):Promise<Reservation>; settleCost(id:string, actual:Money|undefined):Promise<LedgerEntry>; authorizeRequest(input:CostAuthorizationInput):Promise<CostApproval>`.
**Deliverable:** Persist reservations/settlements atomically với requestId uniqueness. Approval pin batch fingerprint, provider/model, currency, cap và expiry; sửa input vô hiệu approval. Unknown quote cần user estimate ceiling hoặc không cho chạy cap-controlled batch; không khẳng định cap là hard vendor billing cap nếu usage uncertain. LLM/ảnh/audio đều qua authorize wrapper trước request, dùng approval hạn mức theo phiên; repair/retry tính vào quota. Không trộn currency.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(twoConcurrentReservations.filter((r) => r.ok).length, 1); // mỗi request 600, cap 1000
await assert.rejects(reserveOtherCurrency(), /CURRENCY_MISMATCH/);
assert.equal(unknownSubmissionReservation.released, false);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/budgetLedger.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Usage unknown giữ pending, hiển thị estimated/confirmed riêng. Mức estimate không đảm bảo vendor charge; UI nói rõ trước approve. Export local cost zero được thể hiện riêng.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 14 Ledger và duyệt ngân sách` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 15: Job runner, restart và unknown submit

**Phụ thuộc:** 10,13,14.
**Files — Create:** main/videoCreation/jobRunner.ts; main/videoCreation/jobStore.ts; main/videoCreation/jobState.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/jobRunner.test.ts.
**Interfaces:** `createJobRunner(deps:JobRunnerDeps):JobRunner; JobRunner.start(batch:ApprovedBatch):Promise<string[]>; resume():Promise<void>; cancel(attemptId:string):Promise<CancelResult>; reconcile(attemptId:string, decision:ReconcileDecision):Promise<void>`.
**Deliverable:** Persist submitting + snapshot + reservation trước mạng; persist remote ID ngay khi nhận. Crash gap → unknown, chỉ reconcile bằng remote ID/vendor lookup/manual acknowledgement. Queue per model account; writes locks, polling exponential backoff jitter cap60s và Retry-After. GET transient có retry, POST chỉ retry khi chứng minh chưa submit hoặc official idempotency. Attempt status và review tách cancelled local/remote. Download/probe/publish atomic.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(afterRestartAdapter.submitCalls, 0);
assert.equal(timeoutAttempt.state, 'unknown');
assert.equal(successfulShotsAfterRetry.length, beforeSuccessCount);
assert.equal(concurrentActive <= accountLimit, true);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/jobRunner.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Shutdown lưu và stop polling; remote jobs không mất ID. Downloads failure chỉ download retry. Reconcile không tự giải phóng budget khi chưa có bằng chứng.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 15 Job runner, restart và unknown submit` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 16: Chọn take và review generation

**Phụ thuộc:** 11,15.
**Files — Create:** main/videoCreation/takeSelection.ts; renderer/components/videoCreation/{GenerationPanel,TakeReview,CostApprovalDialog}.tsx.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/takeSelection.test.ts; renderer/components/**tests**/VideoCreationGeneration.test.tsx.
**Interfaces:** `selectTake(project:VideoProject, shotId:string, attemptId:string, expectedVersion:number):VideoProject; readyForExport(project:VideoProject, episodeId:string):ExportReadiness`.
**Deliverable:** UI tiến độ từng shot, lựa chọn batch, costs, consent payload, failed/unknown/stale. Review checklist identity/outfit/action/continuity/audio; giữ take rejected. Select chỉ accepted artifact cùng snapshot current hoặc explicit keep-old snapshot decision có provenance. Không tự chọn result cũ khi user sửa input trong lúc running.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(editedDuringRun.selectedAttemptId, undefined);
assert.equal(readyForExport(missingTakeProject, episodeId).ready, false);
expect(screen.getByText('Cần đối soát')).toBeVisible();
```

- [ ] **Step 2 — Xác nhận RED:** backend: `npx tsx --test scripts/videoCreation/takeSelection.test.ts`; renderer: `npx jest --runInBand --runTestsByPath renderer/components/__tests__/VideoCreationGeneration.test.tsx`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Retry một shot không rebuild shots khác; user rõ footage đang thuộc revision nào.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 16 Chọn take và review generation` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 17: Assembly shots và timeline thực tế

**Phụ thuộc:** 04,16.
**Files — Create:** main/videoCreation/assembly.ts; main/videoCreation/timeline.ts.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/assembly.test.ts.
**Interfaces:** `buildTimeline(project:VideoProject, episodeId:string, media:MediaInfo[]):EpisodeTimeline; assembleShots(input:AssemblyInput, ctx:AssemblyContext):Promise<AssemblyResult>`.
**Deliverable:** Chỉ take accepted, sort storyboard order, duration từ media probe. Chuẩn hóa canvas 1080p/24fps theo output config, preserve aspect bằng contain/pad default; không stretch. Native audio normalize hoặc mute nếu TTS mode. FFmpeg spawn args arrays, progress/cancel cleanup partial; free disk preflight từ expected intermediate sizes. Immutable assembly snapshot tránh edit mid-export.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.deepEqual(timeline.shotIds, ['a', 'b']);
assert.equal(timeline.durationMs, measuredA + measuredB);
assert.equal(probeOutput.fps, 24);
assert.equal(cancelled.partialExists, false);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/assembly.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Smoke với portrait/landscape và 24/30fps; video decode được, order và audio policy đúng.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 17 Assembly shots và timeline thực tế` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 18: TTS/narration, subtitles và compose bridge

**Phụ thuộc:** 17,14.
**Files — Create:** main/videoCreation/audioBridge.ts; main/videoCreation/exportRunner.ts.
**Files — Modify:** Không; gọi dubbingProcessor và composeRunner APIs hiện có.
**Tests:** scripts/videoCreation/audioBridge.test.ts; scripts/videoCreation/export.test.ts.
**Interfaces:** `buildEpisodeAudio(input:EpisodeAudioInput, deps:AudioBridgeDeps, signal:AbortSignal):Promise<EpisodeAudioResult>; exportEpisode(input:EpisodeExportInput, ctx:EpisodeExportContext):Promise<MediaAsset>`.
**Deliverable:** Chuyển approved dialogue/narration sang subtitle/sidecar speaker metadata cho createDubbingSession. Pin speaker voices bằng mapping, missing voice block. runDubbingBatch/buildDubTrack giữ original timings; overflow fail có suggested edits, không auto shift cả phim. Native mode không tạo TTS mặc định; review speech và subtitle source. runComposeJob với assembly videoPath, subtitles/audio config; asset final atomic.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
await assert.rejects(renderMissingVoice(), /VOICE_REQUIRED/);
assert.equal(nativeMode.ttsRequests, 0);
await assert.rejects(overflowCue(), /DIALOGUE_TOO_LONG/);
assert.equal(finalTracks.video, 1);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/audioBridge.test.ts scripts/videoCreation/export.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; MP4 decode, audio duration/subtitles theo measured timeline; cancel không mark done. Không sửa cơ chế TTS cũ để phù hợp riêng chức năng mới.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 18 TTS/narration, subtitles và compose bridge` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 19: IPC, WorkItem và lifecycle

**Phụ thuộc:** 03,05,06,07,08,09,10,12,14 cho CRUD/creative commands; 15,18 cho jobs/export.
**Files — Create:** main/videoCreation/ipc.ts; main/videoCreation/service.ts; main/videoCreation/lifecycle.ts.
**Files — Modify:** main/background.ts; types/workItem.ts; main/helpers/workItemHandlers.ts; renderer/lib/workItemUtils.ts; renderer/components/launchpad/WorkItemList.tsx (nếu exhaustiveness cần).
**Tests:** scripts/videoCreation/ipc.test.ts; scripts/videoCreation/workItem.test.ts.
**Interfaces:** `createVideoCreationService(deps:VideoServiceDeps):VideoCreationService; setupVideoCreationHandlers(service:VideoCreationService):()=>void; restoreVideoJobs():Promise<void>; shutdownVideoCreation():Promise<void>`.
**Deliverable:** Service command union: list/create/load/update/importText/startDiscovery/answerDiscovery/suggestRemaining/confirmBrief/runScript/extractEntities/linkEntities/generateReference/approveReference/buildStoryboard/approveShots/quote/approveCost/startBatch/pollStatus/cancel/reconcile/selectTake/export/backup/importBackup/delete/listProviders/saveProvider/testProvider. Typed input/output maps Task02, renderer wrapper invoke videoCreation:command. Event videoCreation:changed sanitized {projectId,version,attemptId?}. Register once in background, restore after stores initialized, shutdown before app quit. WorkItem type videoCreation có linkage, aggregate state review/interrupted/done. Delete WorkItem không xóa series; delete project riêng block active jobs/shared assets. Checkpoint19A chỉ nối CRUD/creative/settings đã có; job/export commands trả FEATURE_NOT_READY đến19B. Task21 bổ sung backup/importBackup/cleanup handlers khi module sẵn sàng.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(ipcHandlers.registerCount, 1);
assert.equal(eventPayload.includes(secret), false);
assert.equal(projectExistsAfterDeleteWorkItem, true);
assert.equal(restoredItem.type, 'videoCreation');
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/ipc.test.ts scripts/videoCreation/workItem.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Không sửa generic preload/window types nếu không cần; runtime validate mọi IPC. Task tách hai checkpoint 19A CRUD sớm để 11 chạy, 19B jobs/export muộn tránh dependency cycle.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 19 IPC, WorkItem và lifecycle` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 20: UI xuất và E2E chức năng

**Phụ thuộc:** 11,16,18,19B.
**Files — Create:** renderer/components/videoCreation/ExportPanel.tsx; scripts/e2e/video-creation.mjs; scripts/videoCreation/acceptance.test.ts.
**Files — Modify:** package.json.
**Tests:** renderer/components/**tests**/VideoCreationExport.test.tsx.
**Interfaces:** `ExportPanel({projectId,episodeId}:ExportPanelProps); runVideoCreationAcceptance(service:VideoCreationService, adapters:FakeAdapters):Promise<AcceptanceReport>`.
**Deliverable:** E2E bắt đầu từ Engine→Engine tạo Video: thêm provider tùy chỉnh và lưu; sang video đơn và series hai tập: idea một câu→hỏi làm rõ→AI đề xuất phần thiếu→người dùng confirm brief→script→cast→generated/upload refs→storyboard→budget→fake clips→take→export. Thêm đường import script chi tiết đi thẳng review gaps. Restart ở discovery/queued và sau draft; edit cast phát hiện stale; export progress và reveal result. Fake chỉ test env; transport không gọi mạng. Add npm test:video-creation:e2e và renderer Jest target.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(report.episodesExported, 2);
assert.equal(report.sameCharacterIdAcrossEpisodes, true);
assert.equal(report.mediaRequestsBeforeBriefApproval, 0);
assert.equal(report.externalRequests, 0);
expect(exportButton).toBeDisabled(); // thiếu take
```

- [ ] **Step 2 — Xác nhận RED:** backend: `npx tsx --test scripts/videoCreation/*.test.ts`; renderer: `npx jest --runInBand --runTestsByPath renderer/components/__tests__/VideoCreationExport.test.tsx`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Test chức năng đầy đủ và hồi quy navigation, TaskType pipeline không đổi. Live acceptance dùng Task01/09/13 results, không chạy trả phí trong CI.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 20 UI xuất và E2E chức năng` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 21: Backup, restore và cleanup assets

**Phụ thuộc:** 19B,20.
**Files — Create:** main/videoCreation/backup.ts; main/videoCreation/cleanup.ts; renderer/components/videoCreation/ProjectMaintenance.tsx.
**Files — Modify:** Không.
**Tests:** scripts/videoCreation/backup.test.ts.
**Interfaces:** `exportProjectBackup(projectId:string,destination:string,signal:AbortSignal):Promise<string>; importProjectBackup(source:string,signal:AbortSignal):Promise<VideoProject>; collectUnreferencedAssets(project:VideoProject):string[]`.
**Deliverable:** Bản đầu backup directory package manifest+assets, không thêm zip dependency; UI gọi rõ thư mục backup. Sanitize paths/hash validate/version validate before import staged root. New projectId collision remap, internal character IDs giữ scoped project; remote attempts restore read-only, không resume jobs của project copy. Never include keys/signed URLs. Cleanup duyệt list chỉ unreferenced cả revisions/history/active attempts; chưa đủ disk thì dừng giữ source.

- [ ] **Step 1 — Failing tests:** tạo tests tại paths trên; fixtures và fake IO pin các trường hợp mô tả. Các assertions cốt lõi dưới đây là phần thân tests dùng fixtures từ Task 02; thêm import/setup theo interface của task, không test mạng thực tế mặc định.

```ts
assert.equal(backupContains(secret), false);
assert.equal(restored.characters[0].id, original.characters[0].id);
assert.equal(restored.resumeRemoteJobs, false);
assert.equal(cleanup.includes(sharedRef), false);
```

- [ ] **Step 2 — Xác nhận RED:** `npx tsx --test scripts/videoCreation/backup.test.ts`. Trước code, phải fail vì interface/module chưa có hoặc assertion nghiệp vụ chưa đạt, không nhận lỗi setup runner là RED hợp lệ.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — GREEN:** chạy lại lệnh Step 2, tất cả task assertions PASS; Backup roundtrip còn approved refs/takes/canon; malformed manifest/hash mismatch reject không phá dự án hiện có.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 21 Backup, restore và cleanup assets` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Task 22: Kiểm tra cuối, docs và bàn giao

**Phụ thuộc:** 01–21.
**Files — Create:** docs/docs/features/video-creation.md; docs/superpowers/research/2026-10-13-video-creation-acceptance.md.
**Files — Modify:** docs/sidebars.ts; README.md (chỉ thêm feature nếu phù hợp).
**Tests:** Không có test mirror docs; chạy checks bên dưới.
**Interfaces:** `AcceptanceReport ghi exact provider/model/account capability, measured costs, checks, known limitations; không chứa credentials`.
**Deliverable:** Review spec coverage theo task; verify build/i18n/tests/recovery/export và live evidence. Docs giải thích BYOK, cast revision, approve budget, unknown jobs, backup, audio modes, capability constraints. Không hứa giữ mặt tuyệt đối. Phân biệt task complete/blocked/pending và provider access hạn chế.

- [ ] **Step 1 — Acceptance audit:** đối chiếu từng requirement với kết quả task và bằng chứng; requiredMissing phải rỗng, liveImageEvidence và liveVideoEvidence phải có. Không viết test chỉ để kiểm tra tài liệu.
- [ ] **Step 2 — Chạy verification:** `npm run test:video-creation`, `npm run test:video-creation:e2e`, `npx jest --runInBand --runTestsByPath renderer/components/__tests__/VideoCreationEditor.test.tsx renderer/components/__tests__/VideoCreationGeneration.test.tsx renderer/components/__tests__/VideoCreationExport.test.tsx`, `npm run check:i18n`, `npm run test:work-item-durability`, `npm run test:dubbing-ownership`, `npm run test:compose-output`, `npm run build`. Chạy từng lệnh riêng; expected exit 0 và tests PASS.
- [ ] **Step 3 — Implement:** triển khai interface và deliverable trên; thêm integration wiring thuộc task, không tự thêm provider/capability ngoài scope.
- [ ] **Step 4 — Bàn giao:** tất cả checks PASS; ghi lỗi baseline riêng và không nhận hoàn thành khi lỗi thay đổi gây ra chưa được sửa. Chỉ chạy lại checks khi có sửa code/failure, không lặp lại vô ích.
- [ ] **Step 5 — Checkpoint:** review diff/spec, chỉ stage file của task rồi commit `feat(video-creation): 22 Kiểm tra cuối, docs và bàn giao` khi bắt đầu execution; không stage thay đổi người dùng có sẵn.

## Quyết định triển khai và chỗ cần xác nhận

Đã xác nhận: tự tạo ảnh + upload ảnh; video dùng Veo 3 hoặc Seedance. Đề xuất dùng adapter đầu tiên theo tài khoản truy cập và benchmark, không xây cả hai trước khi một luồng hoàn chỉnh hoạt động.

Chưa cần hỏi thêm để lập kế hoạch. Trước live benchmark cần **provider/endpoint cụ thể, API key nhập qua settings an toàn và hạn mức tiền**. Không yêu cầu paste key vào chat. Hạn mức benchmark không suy ra từ việc người dùng chọn tên provider. Image model cần chọn trong Task01; nếu chưa có dịch vụ ảnh thì Task09 sẽ chờ credentials, các task offline vẫn làm được.

Đề xuất execution: subagent-driven theo từng task vì storage/revisions/ledger/state machine có nhiều failure paths; native vẫn hợp lệ nếu người dùng ưu tiên ít context. Chưa dispatch implementation agents và chưa chạy product code trong giai đoạn lập plan.

## Self-review

- Spec coverage: §1–3 → 02/03/06A/11/19; §4 → 06A/06/10/11; §5 → 04/07/08/09; §6 → 01/05/12A/12–16; §7 →17/18; §8→11A/11/16/20; §9→19; §10–12→20–22.
- Dependency cycle đã giải quyết bằng 19A/19B; 14 có thể chạy ngay sau03,12 sau05,09 sau14,10 sau12. Thứ tự execution thực tế: 01-offline →02→03→04→05→14→06A→06→07→08→12A→12→09→10→19A→11A→11→01-live→13→15→16→17→18→19B→20→21→22. Task06A/12A định nghĩa contracts trước implementation nếu06/12 cần adapter; ledger14 sẵn trước mọi live LLM/ảnh/video.
- Assertions trong task là contract examples cần fixtures/setup trong Step1, không tuyên bố là test đã chạy. Chỉ commands verification hiện có được xác minh paths; scripts mới là deliverable.
- Plan-only: không chạy tests sản phẩm vì chưa sửa sản phẩm. Không tự commit tài liệu hoặc sửa thay đổi ngoài scope. Tổng 25 đơn vị công việc: 22 task chính +06A/11A/12A.

## Nguồn API cho Task01 (đọc lại khi thực thi vì có thể thay đổi)

- Superpowers writing-plans: https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md
- Veo API và model-specific reference images: https://ai.google.dev/gemini-api/docs/veo?hl=en
- Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Seedance/Volcengine tutorial: https://docs.volcengine.com/docs/ark/video-generation-tutorial?lang=en
- BytePlus model/account access: https://docs.byteplus.com/en/docs/modelark/1901652
