# Bảo vệ chuỗi tĩnh nguyện tự động & Điểm thưởng theo Quý

Tính năng này giúp bảo toàn chuỗi tĩnh nguyện của người dùng khi họ lỡ quên 1 ngày trong quý, đồng thời khuyến khích tính tự giác bằng cách thưởng điểm lớn (+15 điểm) vào cuối quý nếu người dùng không sử dụng đến quyền bảo vệ này.

## User Review Required

> [!IMPORTANT]
> Khi hệ thống kích hoạt bảo vệ chuỗi tự động, ngày bị lỡ sẽ được điền tự động vào lịch sử dưới dạng một lượt check-in đặc biệt (với nội dung hiển thị là "Bảo vệ chuỗi tự động"). Lượt này sẽ được tính là +1 check-in và +1 điểm để đảm bảo tính đồng nhất của hệ thống tính toán chuỗi hiện tại.

> [!WARNING]
> Mỗi quý người dùng chỉ được tự động cứu chuỗi **đúng 1 lần**. Nếu lỡ từ 2 ngày liên tiếp trở lên, chuỗi vẫn bị reset về 0.

## Open Questions

> [!NOTE]
> 1. Bạn thấy số điểm thưởng là **15 điểm** cho mỗi quý không dùng khiên bảo vệ đã phù hợp chưa? Bạn có muốn tăng hoặc giảm số điểm này không?
> 2. Quý hiện tại (Q1) đã chạy từ ngày 20/05/2026. Một số người dùng đã lỡ chuỗi trước đó (lostStreaks > 0). Bạn có muốn áp dụng quyền bảo vệ hồi tố cho họ ngay trong quý này (nghĩa là họ vẫn được cấp 1 khiên cho Q1 từ thời điểm này trở đi), hay chỉ áp dụng cho các lượt lỡ chuỗi phát sinh kể từ khi cập nhật tính năng?

## Proposed Changes

### 1. Định nghĩa Quý Chiến dịch
Chiến dịch bắt đầu từ ngày **20/05/2026** (được lưu tại `campaignStartDateStr` trong MongoDB). Mỗi quý kéo dài đúng 3 tháng:
- **Quý 1 (Q1):** 20/05 đến 19/08 (Dương lịch)
- **Quý 2 (Q2):** 20/08 đến 19/11
- **Quý 3 (Q3):** 20/11 đến 19/02 (năm sau)
- **Quý 4 (Q4):** 20/02 đến 19/05 (năm sau)

Hàm tính quý từ một ngày bất kỳ `dateStr` dựa trên `startDateStr`:
```javascript
function getCampaignQuarter(dateStr, startDateStr) {
    const start = new Date(startDateStr || '2026-05-20');
    const current = new Date(dateStr);
    if (current < start) return "Y1-Q1";
    
    const diffYears = current.getFullYear() - start.getFullYear();
    let diffMonths = (current.getMonth() - start.getMonth()) + (diffYears * 12);
    if (current.getDate() < start.getDate()) {
        diffMonths -= 1;
    }
    
    const totalQuarters = Math.floor(diffMonths / 3) + 1;
    const campaignYear = Math.floor((totalQuarters - 1) / 4) + 1;
    const qInYear = ((totalQuarters - 1) % 4) + 1;
    
    return `Y${campaignYear}-Q${qInYear}`;
}
```

### 2. Các thay đổi đối với Database (Schema)
Thêm các trường sau vào `User` model:
- `lastActiveQuarter`: Lưu trữ quý hoạt động gần nhất của người dùng (Ví dụ: `"Y1-Q1"`).
- `streakProtectionHistory`: Bản đồ lưu trữ trạng thái sử dụng khiên bảo vệ của từng quý (Ví dụ: `{"Y1-Q1": false, "Y1-Q2": true}`).

### 3. Quy trình vận hành & Logic xử lý
#### A. Khi người dùng tương tác (Đăng nhập, Check-in)
Hệ thống sẽ chạy kiểm tra chuyển giao Quý trong `checkAndResetStreak`:
1. Xác định quý hiện tại dựa trên `localDate`.
2. Nếu `user.lastActiveQuarter` khác với quý hiện tại (tức là đã chuyển sang quý mới):
   - Kiểm tra xem trong quý cũ (`user.lastActiveQuarter`), người dùng đã sử dụng khiên chưa.
   - Nếu **chưa sử dụng** (`streakProtectionHistory.get(lastActiveQuarter) !== true`):
     - **Cộng 15 điểm** vào `totalPoints` của người dùng.
     - Thêm một bản ghi vào nhật ký `dailyLogs` để thông báo: `q1: "Điểm thưởng khiên bảo vệ", q2: "Cộng 15 điểm thưởng vì không sử dụng khiên bảo vệ chuỗi trong quý trước!"`
   - Cập nhật `user.lastActiveQuarter` thành quý hiện tại.
   - Khởi tạo trạng thái cho quý mới: `streakProtectionHistory.set(currentQuarter, false)`.

#### B. Kích hoạt Bảo vệ Chuỗi Tự động
Khi người dùng bị lỡ điểm danh (`daysPassed === 2`):
- Kiểm tra trạng thái khiên của quý hiện tại.
- Nếu **chưa sử dụng**:
  1. Đánh dấu đã sử dụng: `streakProtectionHistory.set(currentQuarter, true)`.
  2. Tạo bản ghi check-in giả lập cho ngày bị lỡ để duy trì chuỗi:
     - Thêm ngày bị lỡ vào `history` và sắp xếp lại.
     - Thêm log vào `dailyLogs`: `q1: "Bảo vệ chuỗi tự động", source: "Hệ thống", emotion: "😇"`.
     - Tăng `totalCheckins` và `totalPoints` lên 1 đơn vị.
     - Cập nhật `lastCheckinDateStr = ngày_bị_lỡ`.
     - Đặt `hasCheckedInToday = false` để người dùng có thể check-in tiếp cho ngày hôm nay.
  3. Trả về cờ `justRestoredStreak = true` để Client hiển thị thông báo chúc mừng/nhắc nhở.
- Nếu **đã sử dụng** hoặc lỡ từ 2 ngày trở lên (`daysPassed > 2`):
  - Chuỗi bị reset về 0 và tăng `lostStreaks` lên 1 như bình thường.

---

## Các tệp tin thay đổi

### 1. Backend: [server.js](file:///d:/Visual%20Studio%20Code/app%20giu-chuoi-tinh-nguyen/server.js)
- Thêm `lastActiveQuarter` và `streakProtectionHistory` vào Mongoose Schema.
- Thêm hàm hỗ trợ `getCampaignQuarter(dateStr, startDateStr)`.
- Cập nhật hàm `checkAndResetStreak` để tự động xử lý bảo vệ chuỗi và cộng điểm thưởng khi đổi quý.
- Sửa lại API `/api/login`, `/api/auto-login`, `/api/update-streak` để trả về cờ thông báo khi khiên được kích hoạt hoặc khi nhận điểm thưởng.

### 2. Frontend: [index.html](file:///d:/Visual%20Studio%20Code/app%20giu-chuoi-tinh-nguyen/index.html)
- Thêm hàm hỗ trợ `getCampaignQuarter` trên client.
- Thêm ô hiển thị trạng thái Khiên bảo vệ (`Sẵn sàng` 🛡️ hoặc `Đã dùng`) ngay cạnh ô hiển thị `Lỡ chuỗi` trên Dashboard.
- Cập nhật hàm `updateUIFromData` để render màu sắc và trạng thái khiên theo dữ liệu từ server.
- Hiển thị thông báo Popup chúc mừng khi khiên được kích hoạt cứu chuỗi thành công, hoặc khi nhận điểm thưởng đầu quý mới.

---

## Kế hoạch Xác minh (Verification Plan)

### Kiểm thử Thủ công (Chế độ Test)
1. **Kiểm tra tự động cứu chuỗi:**
   - Tạo một tài khoản test, thực hiện check-in vào ngày 1.
   - Sửa ngày hệ thống/ngày test sang ngày 3 (để lỡ ngày 2).
   - Thực hiện đăng nhập/check-in $\rightarrow$ Xác minh hệ thống tự kích hoạt Khiên bảo vệ cho ngày 2, chuỗi được giữ nguyên, trạng thái khiên chuyển sang "Đã dùng".
2. **Kiểm tra đổi quý & Điểm thưởng:**
   - Dùng tài khoản test chưa sử dụng khiên ở Quý 1.
   - Giả lập chuyển sang ngày của Quý 2 (sau ngày 20/08).
   - Đăng nhập/Check-in $\rightarrow$ Xác minh tài khoản được cộng 15 điểm thưởng và nhận thông báo chúc mừng.
