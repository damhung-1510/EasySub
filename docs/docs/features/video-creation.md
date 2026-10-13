---
title: Tạo video và series
---

Mở **Tạo video** trong thanh điều hướng. Có thể tạo dự án video đơn hoặc series; mỗi tập lưu ý tưởng, kịch bản, storyboard, các lần tạo và bản xuất riêng. Thư viện nhân vật dùng chung cho toàn series, còn mỗi lần thay đổi ngoại hình/giọng nói tạo một revision để những cảnh cũ vẫn trỏ về đúng phiên bản đã dùng.

Trước tiên cấu hình **Engine tạo Video** ở màn hình Engine. Thêm provider video (Veo 3.1, Veo 3.0, Seedance Ark hoặc một cấu hình async JSON tùy chỉnh) và provider ảnh (Gemini image hoặc OpenAI image), điền endpoint/model và khóa API. Các cấu hình độc lập và có thể chọn theo dự án. Khóa API không nằm trong file dự án, backup hay bản xuất cấu hình. Nếu hệ điều hành không cung cấp secure storage, khóa chỉ sống trong phiên ứng dụng.

Quy trình cho một tập:

1. Ghi ý tưởng hoặc nhập kịch bản gốc. Phần **Làm rõ ý tưởng** hỏi từng câu về mục tiêu, xung đột, nhân vật, bối cảnh, ngôn ngữ, thoại và kết thúc. Câu trả lời của khách được phân biệt với gợi ý AI. Đọc, sửa và xác nhận brief trước khi viết kịch bản.
2. Tạo, nhập phân tích hoặc sửa kịch bản theo cảnh. Bóc nhân vật, địa điểm và đạo cụ; xác nhận nhân vật mới hoặc gộp với nhân vật đã có trong series. Ảnh tham chiếu có thể tải lên hoặc tạo từ mô tả bằng engine ảnh, sau đó phải duyệt. Duyệt kịch bản khi các nhân vật đã được xác nhận.
3. Chọn engine video, tạo storyboard theo khả năng model, chỉnh từng cảnh quay rồi duyệt. Mỗi shot giữ ID nhân vật, revision hồ sơ, ảnh tham chiếu, bối cảnh và phong cách đã chốt. Nếu sửa hồ sơ nhân vật, dùng **Cập nhật hồ sơ nhân vật** để gắn ảnh/revision mới rồi duyệt lại shot. Take cũ vẫn được giữ; muốn dùng nó trong bản xuất phải chọn rõ quyết định giữ take cũ.
4. Xem báo giá và giới hạn chi phí, duyệt trước khi gửi batch. Theo dõi job, xử lý kết quả không rõ trạng thái bằng ID phía nhà cung cấp hoặc bằng chứng chưa gửi, xem từng take và chọn take dùng để xuất. Trạng thái không rõ không được tự gửi lại để tránh tính tiền hai lần.
5. Chọn âm thanh gốc hoặc thiết lập giọng đọc/TTS, duyệt chi phí âm thanh nếu có, rồi xuất MP4 và phụ đề. Có thể sao lưu dự án cùng assets để phục hồi trên máy khác.

Giới hạn viết kịch bản được lưu theo dự án, tập và provider LLM. Trên màn hình có số lượt đã dùng; đổi hạn mức hoặc hết phiên thì đánh dấu **Bắt đầu phiên ngân sách mới** rồi duyệt lại. Phần này giữ hạn mức do người dùng cho phép và số lượt gọi; số tiền thực tế vẫn tùy vào thông tin billing phía provider. Khi chưa có báo giá chắc chắn, app giữ khoản dự phòng, không tự coi nó là chi phí bằng không.

Veo 3.1 là đường đi phù hợp cho shot cần ảnh nhận dạng nhân vật trong bản này. Adapter Seedance Ark hiện dùng ảnh khung đầu; nó chưa truyền ảnh nhận dạng nhân vật tương đương Veo. Các kết hợp thời lượng, độ phân giải và số ảnh được kiểm tra trước khi gửi. Khả năng giữ nhân vật, đồng bộ thoại và giá thực tế vẫn phải đánh giá trên tài khoản/model cụ thể trước khi dùng sản xuất.

Chức năng dựng lại một video có sẵn với bối cảnh hoặc ngôn ngữ khác nằm ngoài phiên bản tạo video này.

Chi tiết kỹ thuật và mức kiểm chứng: [thiết kế](../../superpowers/specs/2026-10-13-video-creation-design.md), [ma trận provider](../../superpowers/research/2026-10-13-video-provider-matrix.md), [bằng chứng acceptance](../../superpowers/research/2026-10-13-video-creation-acceptance.md).
