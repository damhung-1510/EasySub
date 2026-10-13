# Thiết kế chức năng tạo video và series

Trạng thái: người dùng cho phép lập kế hoạch chi tiết ngày 2026-10-13; chưa triển khai sản phẩm.
Ngày: 2026-10-13.
Cập nhật: API cấu hình tại Engine → Engine tạo Video; bổ sung hội thoại làm rõ ý tưởng trước sản xuất.

## 1. Mục tiêu và phạm vi

Xây dựng chức năng trong EasySub để người dùng nhập ý tưởng hoặc kịch bản, phát triển kịch bản chi tiết, bóc tách nhân vật, tạo cảnh qua API ngoài và xuất video. Người dùng có thể tạo video độc lập hoặc series nhiều tập, tái sử dụng nhân vật xuyên suốt. Đây là chức năng tổng quát, không phải yêu cầu sản xuất một video cụ thể.

Yêu cầu đã xác nhận: làm tạo video trước; tận dụng obra/superpowers; kịch bản đầy đủ, chi tiết; nhân vật lấy từ kịch bản và giữ xuyên video/series. Remake video có sẵn nằm ngoài đợt này.

Các lựa chọn đề xuất của người thiết kế, chưa phải lựa chọn người dùng đã chốt: local-first, BYOK (người dùng cung cấp API key), một video provider thực tế ở bản đầu, hỗ trợ ảnh tham chiếu nhân vật, tiếng Việt cho giao diện mới theo cơ chế i18n hiện tại, có bước duyệt trước khi gửi tác vụ mất phí. Không cài thêm plugin hoặc dependency trong giai đoạn lập thiết kế.

## 2. Áp dụng Superpowers đúng vai trò

Superpowers là bộ skill và phương pháp phát triển phần mềm, không phải API biên kịch hay video. Dùng brainstorming để chốt thiết kế, writing-plans sau khi thiết kế được duyệt, rồi kiểm thử và review khi triển khai. Không gọi Superpowers như một video provider và không hứa cài plugin trong app sẽ làm video tốt hơn.

Trong sản phẩm, chuyển cách hỏi và phản hồi của skill Superpowers brainstorming thành workflow làm rõ nội dung có prompt/version được kiểm soát. Lưu nguồn skill và commit SHA thực tế lúc tích hợp; nếu sao chép nội dung, giữ MIT notice. Không giả định plugin của coding agent chạy được trong app; không đưa các hướng dẫn build/commit/subagent của skill vào hội thoại khách hàng. Workflow hỏi bằng ngôn ngữ sáng tác, không hiện thuật ngữ kỹ thuật. Dùng LLM qua adapter cấu trúc, có prompt/schema/version và khả năng sửa từng phần. Nếu tái sử dụng nội dung nguồn của Superpowers, lưu phiên bản/commit và giữ thông báo MIT theo license; không tự động tải skill từ main rồi chạy trong sản phẩm.

## 3. Mô hình tổ chức

Series → Episode → ScriptRevision → Scene → Shot → GenerationAttempt → Artifact.

Video độc lập là project một episode, không ép người dùng nhập thông tin series. Mỗi series có Series Bible: tiền đề, thế giới, thể loại, phong cách, quy tắc, nhân vật, địa điểm, đạo cụ và diễn biến đã được xác nhận. Mỗi episode có brief riêng, trạng thái và thứ tự. Có thể làm tập sau trước, nhưng chỉ dùng các sự kiện canon được người dùng xác nhận cho timeline phù hợp.

Nội dung sáng tác lưu trong project store riêng; WorkItem chỉ theo dõi công việc sinh video và liên kết projectId/episodeId. Không nhét toàn bộ series vào configSnapshot hay session hội thoại của Assistant.

## 4. Workflow kịch bản

1. Nhập ý tưởng hoặc dán/nhập kịch bản dạng văn bản; chọn video đơn/series, ngôn ngữ, phong cách, mục tiêu thời lượng, tỷ lệ khung hình, mức lời thoại và narration. Không bắt nhập mọi trường mới được bắt đầu; có default hiển thị rõ.
2. Làm rõ ý tưởng bằng hội thoại có cấu trúc trước khi viết: nhận diện điều khách hàng đã xác nhận, điều AI suy luận và điểm còn thiếu. Mỗi lượt hỏi một câu có giá trị nhất, không hỏi lại thông tin đã có. Bao phủ mục tiêu/đối tượng, tiền đề, xung đột, động cơ/tính cách/quan hệ nhân vật, thế giới/địa điểm/thời điểm, nhịp kể, kết thúc, mức lời thoại/ngôn ngữ/cách nói và phong cách/thời lượng. Đưa các hướng phát triển khi khách hàng chưa quyết định; chỉ coi đề xuất là đã xác nhận sau khi người dùng nhận. Có thể chọn “AI đề xuất phần còn thiếu”, khi đó tạo draft và liệt kê assumptions để duyệt thay vì giữ khách trong vòng hỏi vô hạn. Kịch bản chi tiết có thể đi thẳng đến kiểm tra và xác nhận các khoảng trống.
3. Tạo brief có mục tiêu nội dung, đối tượng, tiền đề và hạn chế sản xuất. Kịch bản có sẵn được phân tích và giữ nguyên bản gốc; viết lại là hành động riêng do người dùng chọn.
4. Tạo dàn ý/beat sheet: mở đầu, phát triển, cao trào, kết thúc; series thêm tuyến dài hạn và điểm nối giữa tập.
5. Viết kịch bản có cấu trúc: cảnh, địa điểm, thời điểm, nhân vật, hành động, lời thoại gắn speakerId, cảm xúc, narration, âm thanh và ước lượng thời lượng.
6. Bóc nhân vật, địa điểm, đạo cụ; đánh dấu thông tin suy luận hoặc thiếu. Không tự biến mô tả đoán thành dữ kiện đã được xác nhận.
7. Review logic, động cơ nhân vật, nối cảnh, lượng lời thoại, mâu thuẫn với canon và khả năng quay bằng model đã chọn. Kết quả là danh sách vấn đề và đề xuất sửa, không tự ghi đè bản đã duyệt.
8. Người dùng sửa/duyệt kịch bản và hồ sơ nhân vật. Lưu revision bất biến khi duyệt.
9. Chuyển thành shot list/storyboard: mỗi shot có mục đích, nhân vật, hành động, camera, ánh sáng, môi trường, thời lượng, continuity vào/ra, lời thoại và prompt. Scene là đơn vị kể chuyện; Shot là đơn vị gửi API. Một scene có thể có nhiều shot.

Điều kiện sẵn sàng sản xuất: brief/kịch bản được duyệt, thiếu sót chặn sản xuất được giải quyết, speaker/cast/bối cảnh và ảnh chuẩn được xác nhận, shots hợp capability và lời thoại phù hợp thời lượng. Bảng tóm tắt nêu premise, nhân vật, bối cảnh, tuyến truyện, thoại, assumptions và vấn đề mở. Review có thể đề xuất ít cảnh/địa điểm/nhân vật để giảm chi phí, nhưng không tự đổi ý tưởng của khách. Bước hỏi/viết dùng LLM và vẫn tiêu tốn chi phí; có budget/session, usage và khả năng resume. Không tạo ảnh/video để minh họa ngầm trong lúc hỏi.

Mỗi bước có thể chạy lại độc lập; bước sau nhận đầu vào có revision rõ ràng. Hạn chế context bằng truy xuất nhân vật và canon liên quan, không đưa toàn bộ mọi tập vào mỗi prompt. LLM trả dữ liệu có schema; kiểm tra ID, speaker và quan hệ, sửa JSON lỗi tối đa 2 lần rồi hiển thị lỗi có thể thử lại. Không tự lặp vô hạn.

## 5. Nhân vật xuyên suốt

Character có ID bền vững, tên và aliases. Hồ sơ gồm ngoại hình, tuổi/nhóm tuổi, tỉ lệ cơ thể, đặc điểm nhận diện, tính cách, động cơ, cách nói, quan hệ, giọng và các thuộc tính không được thay đổi. Tách Identity (ổn định) khỏi AppearanceVariant (trang phục, kiểu tóc, tuổi theo tuyến truyện) và EpisodeState (vết thương, vật đang cầm, trạng thái cảm xúc...).

Trích xuất từ kịch bản đề xuất liên kết với nhân vật đã có trong series; trùng tên không tự gộp, đổi tên không tạo nhân vật mới nếu ID giữ nguyên. Người dùng xác nhận nhân vật mới, gộp hoặc liên kết. Lời thoại và shot tham chiếu ID, không nối bằng tên thuần túy.

ReferencePack là ảnh người dùng tải lên hoặc ảnh tạo qua image provider tương thích: chân dung, toàn thân, góc nghiêng và trang phục cần thiết. Người dùng xác nhận bản đầu phải có cả tự tạo ảnh từ mô tả và upload ảnh. Bước tạo góc nhìn/biến thể tiếp theo phải dùng ảnh chuẩn đã duyệt làm reference khi model hỗ trợ, không tạo độc lập chỉ từ text. Người dùng chọn ảnh chuẩn, đánh dấu approved và khóa một revision. References lưu file nội bộ cùng hash; URL provider không là nguồn lưu trữ duy nhất.

Mỗi shot pin characterRevisionId + appearanceVariantId + referenceAssetIds, locationRevision và styleRevision. Prompt compiler kết hợp các hồ sơ này với chỉ dẫn shot theo giới hạn từng provider. Seed là tùy chọn khi provider hỗ trợ, không là cơ chế đảm bảo danh tính. Không hứa giữ mặt giống 100%; đo bằng benchmark và duyệt bằng mắt. Provider không đủ khả năng đưa references cần thiết không được tự chuyển sang text-only: báo thiếu capability và cho người dùng quyết định.

Sửa hồ sơ nhân vật tạo revision mới. Episode/shot đã duyệt tiếp tục dùng bản cũ; người dùng chọn migrate cảnh nào. Thay input khiến kết quả phụ thuộc được đánh dấu stale, không xóa footage và không tự tạo lại mất phí. Cuối tập đề xuất canon delta từ kịch bản đã duyệt; chỉ cập nhật canon khi người dùng xác nhận, không rút canon từ bản nháp hoặc hallucination của video.

## 6. Tạo footage và ghép thành phẩm

Pipeline: approved script → approved cast/reference → approved shots → capability validation → quote/budget → submit → poll → download/validate → review → timeline/audio/subtitle → export.

Video adapter: getCapabilities(), estimateCost(request), submit(request), getJob(jobId), cancel(jobId) nếu hỗ trợ, downloadResult(job). Capability bao gồm text/image/reference inputs, số reference, thời lượng hợp lệ, tỷ lệ/resolution, audio, seed, concurrency và cancel. Người dùng chọn Veo 3 hoặc Seedance làm ứng viên; chọn model/endpoint cụ thể theo benchmark và quyền truy cập tài khoản. Bản đầu chỉ cần một adapter chạy thật và một fake adapter cho test; adapter thứ hai nằm ở đợt tiếp theo. Veo 3 và Veo 3.1 phải phân biệt capability theo model, không giả định mọi phiên bản đều nhận referenceImages.

Tạo tác vụ riêng cho từng shot, lưu request fingerprint, provider/model version, input revision, remote jobId, trạng thái và artifact. State: draft, ready, submitting, queued, running, downloading, review, accepted, failed, unknown, cancelled. Nếu timeout khi submit và không rõ server đã nhận, dùng unknown và reconcile; không tự submit lại có thể tính phí hai lần. Idempotency chỉ dùng khi API có hỗ trợ. Restart app tiếp tục poll job đã biết; hủy local không đồng nghĩa provider hoàn tiền hay đã hủy remote.

Ngân sách tách LLM, ảnh, video, audio và export. Quote có currency, timestamp và mức chắc chắn; không giả lập đơn giá không biết. Reservation khi submit, settle khi có usage; retry tạo lần mới vẫn phải đủ ngân sách. Người dùng duyệt batch shots trước lần gửi mất phí, có tùy chọn phạm vi ngân sách cho batch; cảnh vượt giới hạn dừng để duyệt thêm. Cho phép tạo riêng một shot, chọn take và retry shot lỗi mà không chạy lại cả video.

Tải kết quả ngay khi xong, kiểm tra MIME/kích thước/duration rồi lưu local để không phụ thuộc URL hết hạn. Remote URL phải qua cơ chế kiểm tra mạng hiện có; không ghi API key hoặc signed URL vào log. Key chỉ xử lý phía main, lưu bằng cơ chế bảo mật phù hợp desktop, không đưa vào renderer hay file export.

## 7. Âm thanh và timeline

Hai chế độ tách biệt: native audio của provider hoặc TTS/narration từ EasySub. Không trộn hai nguồn lời thoại mặc định. Với native audio, cần bước kiểm tra lời thoại/ngôn ngữ thực tế; có thể chuyển sang TTS nếu người dùng chọn. Với TTS, pin voice/provider/voiceId ở character revision; một identity có mapping giọng theo ngôn ngữ. Thiếu giọng không được thay ngầm.

Bản đầu bảo đảm voiceover/narration + subtitles; đối thoại với khẩu hình chính xác là capability tùy chọn hoặc giai đoạn sau, phải thể hiện rõ trên UI. Có thể viết kịch bản theo narration nếu chưa có lip-sync. Shot duration thực tế là nguồn cho timeline; lời dài cho slot yêu cầu sửa lời, chỉnh duration hoặc tạo lại. Không cắt lời im lặng. Chuẩn hóa resolution/fps/audio trước khi nối; thêm bước assembly FFmpeg mới vì compose hiện tại chủ yếu nhận một video nguồn. Sau assembly mới tái sử dụng dubbing/compose/subtitle có sẵn.

## 8. Trải nghiệm chức năng

Mục Tạo video trong navigation phục vụ sản xuất. API settings nằm tại trang Engine hiện có, section chính xác “Engine tạo Video”. Không đặt màn cấu hình provider riêng ở trang Tạo video; trang sản xuất chỉ chọn provider/model đã cấu hình và dẫn đến Engine khi thiếu. Section quản lý nhiều provider instances; mẫu Veo/Seedance và custom endpoint dùng protocol profile có sẵn. Các trường: tên, protocol, base URL, API key/auth mode, model ID, timeout, concurrency, capabilities và pricing override có nguồn/ngày. Có import/export config không gồm secret; trạng thái chưa kiểm chứng khác ready. Tùy chỉnh tham số qua allowlist/typed JSON không được ghi đè auth, request IDs hoặc references đã pin. API custom không tương thích protocol sẵn có cần declarative mapping profile được validate; không chạy JS/shell từ config. HTTPS mặc định; HTTP chỉ cho localhost được người dùng cấu hình rõ; auth header không chuyển qua redirect khác origin. Không đồng nhất “OpenAI-compatible chat” với video API. Image generation config thuộc nhóm phụ “Ảnh nhân vật” trong section này; LLM chọn lại provider văn bản hiện có. ASR/GPU giữ module và contract hiện có. Danh sách project/series và tập. Trong episode có các khu vực: Ý tưởng & làm rõ, Brief, Kịch bản, Nhân vật, Storyboard, Tạo cảnh, Xuất video. Người dùng thấy trạng thái cảnh, take được chọn, cảnh stale, preview và tổng chi phí đã dùng/dự kiến. Series có thư viện nhân vật/địa điểm và timeline canon dùng chung. Mọi bước có lưu nháp và phục hồi sau restart. Có thể đi từ kịch bản sẵn thẳng đến phân tích; không ép chạy lại quy trình sáng tác.

## 9. Điểm tích hợp và file dự kiến

Mới: types/videoProject.ts, types/videoProvider.ts; main/videoCreation/{projectStore,scriptWorkflow,characterResolver,continuityValidator,promptCompiler,providerRegistry,jobRunner,budgetLedger,assembly,ipc}.ts; main/videoCreation/providers/{fake,firstProvider}.ts; renderer/pages/[locale]/videoCreation.tsx và renderer/components/videoCreation/; renderer/components/resources/engines/panels/VideoProviderPanel.tsx và renderer/hooks/useVideoProviders.ts; bộ bản dịch videoCreation theo locales hiện có.

Sửa có kiểm soát: types/workItem.ts thêm videoCreation; main/helpers/workItemStore.ts và workItemHandlers.ts liên kết/trạng thái; main/preload.ts và types/window.d.ts cho IPC; main/helpers/ipcHandlers.ts đăng ký; renderer/lib/taskTypes.ts và navigation thực tế sau khi khảo sát. main/assistant/provider.ts chỉ được tái sử dụng qua adapter structured generation sau khi kiểm tra interface, không lấy session chat làm database.

Project store versioned có atomic writes, asset manifest và migration; metadata nhỏ có thể dùng JSON, assets ngoài store. Đề xuất roots theo helpers/storagePaths hiện có. Không yêu cầu database server. Backup/export project không bao gồm secret; delete project cần xử lý asset đang được episode khác tham chiếu.

## 10. Lộ trình và tiêu chí nghiệm thu

P0 – Benchmark provider: clip thử có một và hai nhân vật, đổi góc, cùng nhân vật ở hai episode, ảnh chuẩn, narration/đối thoại, references vượt giới hạn. Chọn API khi biết truy cập tài khoản, giới hạn và chất lượng thật. Deliverable: capability matrix + kết quả + chi phí thực tế, không chỉ clip demo đẹp.

P1 – Project/series + kịch bản: CRUD, revision, structured LLM, import text, dàn ý, script review. Nghiệm thu: nhập script giữ bản gốc, LLM lỗi không hỏng dữ liệu, mở lại app còn draft.

P2 – Cast/continuity + storyboard: extraction, aliases, refs, variants, pinned revisions, canon delta. Nghiệm thu: nhân vật xuất hiện trong nhiều tập có cùng ID; sửa tên giữ speaker links; sửa approved profile không thay input shot cũ; cảnh có revision mới được đánh dấu stale; unknown speaker bị chặn trước submit.

P3 – Video jobs: adapter thật, fake, IPC, queue, quote/ledger, persistence/reconcile. Nghiệm thu: phục hồi polling; timeout submit không tự tính phí lặp; 429 có backoff; job thất bại không mất shot thành công; vượt budget bị chặn; thiếu references/capability có thông báo rõ.

P4 – Review/assembly/export: chọn take, nối shots, TTS/narration, subtitles, xuất MP4. Nghiệm thu: video đơn hoàn chỉnh và series hai episode dùng chung cast; đúng thứ tự take; chữ/âm thanh khớp timeline thực; output hợp lệ với clip fps/resolution khác nhau.

P5 – Hoàn thiện: backup/import project, cleanup refs an toàn, diagnostics đã redact, docs, i18n và review. Lip-sync, timeline dựng phim chuyên sâu và remake là đợt mở rộng riêng.

Sau thiết kế được duyệt, writing-plans sẽ tách từng pha thành task nhỏ có path, interface, failing test, lệnh chạy test, expected result và checkpoint. Đây là roadmap thiết kế, chưa phải kế hoạch thực thi đã được phê duyệt. Không ghi mọi chi tiết code khi provider/schema còn chưa được thử.

## 11. Kiểm thử và chất lượng

Unit/contract tests cho schemas, resolver, revisions, stale dependencies, budget, adapter, state machine và prompt compiler. Integration với fake provider cho restart, URL hết hạn, timeout, cancel, 429 và input sửa khi job đang chạy. E2E cho tạo project → import script → xác nhận cast → storyboard → fake footage → export. FFmpeg smoke test kiểm tra thời lượng, tracks và thứ tự. Kiểm tra hồi quy WorkItem/dubbing/compose; dùng test runner hiện có sau khảo sát.

Chất lượng nhân vật cần benchmark có người duyệt: đánh giá ngoại hình, trang phục, động tác, nền, continuity và độ đúng lời. Không dùng unit test hoặc similarity score như chứng minh nhân vật giữ nguyên hoàn toàn. Ghi rõ model/request của từng take để giải thích kết quả. Không công bố SLO thời gian/chi phí hoặc phần trăm độ giống chưa có đo thực tế.

## 12. Lưu ý đề xuất

- Giữ nhất quán địa điểm/đạo cụ/phong cách bên cạnh nhân vật, vì chúng cũng làm series mất continuity.
- Duyệt storyboard và reference trước khi tốn tiền video; hình tốt thường cần chọn lại take.
- Khi đổi provider, cảnh cũ vẫn pin provider cũ; provider mới cần benchmark lại ngoại hình.
- Đầu vào ảnh/giọng người thật phải có quyền sử dụng; cho biết rõ dữ liệu nào được tải lên dịch vụ, theo consent hiện có.
- Không làm hệ thống tự động hàng loạt trước khi kiểm soát submit không rõ kết quả và ngân sách.
- Cho phép nhập script tốt có sẵn, sửa từng cảnh, không ép AI viết lại mọi thứ.
- Giữ prompt/schema/version làm dữ liệu có thể truy vết; chỉ lưu rationale hữu ích, không yêu cầu chain-of-thought của model.

## Tài liệu tham khảo

- https://github.com/obra/superpowers
- https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md
- https://docs.dev.runwayml.com/api/
- https://ai.google.dev/gemini-api/docs/veo?hl=en
