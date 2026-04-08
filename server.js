const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();

// Bạn nhớ đổi origin này theo link mới trên Github của bạn nhé
app.use(cors({ origin: '*' })); 
app.use(express.json()); 

const MONGO_URI = "mongodb+srv://nguyenanh:16102006@cluster0.iwcowsc.mongodb.net/TinhNguyenApp?retryWrites=true&w=majority"; // Thay bằng link DB của bạn

mongoose.connect(MONGO_URI)
  .then(() => console.log('Đã kết nối Database thành công!'))
  .catch(err => console.log('Lỗi kết nối DB:', err));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  currentStreak: { type: Number, default: 0 },
  maxStreak: { type: Number, default: 0 },
  lostStreaks: { type: Number, default: 0 },
  totalCheckins: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  hasCheckedInToday: { type: Boolean, default: false },
  lastCheckinDate: { type: Date, default: null }, // Lưu lại ngày cuối cùng điểm danh
  history: [{ type: String }] // Mảng lưu các ngày đã hoàn thành 'YYYY-MM-DD'
});

const User = mongoose.model('User', userSchema);

// Hàm tính khoảng cách ngày (bỏ qua giờ giấc)
function getDaysDiff(date1, date2) {
    if (!date1 || !date2) return 0;
    const d1 = new Date(date1); d1.setHours(0, 0, 0, 0);
    const d2 = new Date(date2); d2.setHours(0, 0, 0, 0);
    return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

// API Đăng ký
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const existingUser = await User.findOne({ username: username });
    if (existingUser) return res.status(400).json({ success: false, message: 'Tên tài khoản đã tồn tại' });

    const totalUsers = await User.countDocuments();
    const role = totalUsers === 0 ? 'admin' : 'user';
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword, role });
    await newUser.save();
    res.json({ success: true, user: newUser });
  } catch (error) { res.status(500).json({ success: false, message: 'Lỗi server' }); }
});

// API Đăng nhập VÀ KIỂM TRA MẤT CHUỖI
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username });
    if (!user) return res.status(400).json({ success: false, message: 'Tài khoản không tồn tại' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Sai mật khẩu' });

    // KIỂM TRA NGÀY THÁNG ĐỂ RESET CHUỖI
    let justLostStreak = false;
    const today = new Date();
    const daysPassed = getDaysDiff(user.lastCheckinDate, today);

    // Nếu qua 1 ngày (là ngày hôm qua chưa điểm danh) hoặc lâu hơn
    if (daysPassed > 1 && user.currentStreak > 0) {
        user.currentStreak = 0;
        user.lostStreaks += 1;
        user.hasCheckedInToday = false;
        justLostStreak = true;
        await user.save();
    } else if (daysPassed === 1) {
        // Đã qua ngày mới, mở khóa nút điểm danh
        if (user.hasCheckedInToday) {
            user.hasCheckedInToday = false;
            await user.save();
        }
    }

    // Gửi kèm biến justLostStreak để Frontend hiện thông báo đỏ
    const userResponse = user.toObject();
    userResponse.justLostStreak = justLostStreak;

    res.json({ success: true, user: userResponse });
  } catch (error) { res.status(500).json({ success: false, message: 'Lỗi server' }); }
});

// API Điểm danh
app.post('/api/update-streak', async (req, res) => {
    try {
        const { userId, action } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });

        if (action === 'checkin' && !user.hasCheckedInToday) {
            const todayStr = new Date().toISOString().split('T')[0];
            
            user.currentStreak++;
            user.maxStreak = Math.max(user.maxStreak, user.currentStreak);
            user.totalCheckins++;
            user.totalPoints++;
            user.hasCheckedInToday = true;
            user.lastCheckinDate = new Date();
            
            // Lưu vào lịch sử nếu chưa có
            if (!user.history) user.history = [];
            if (!user.history.includes(todayStr)) {
                user.history.push(todayStr);
            }
        } 
        
        await user.save();
        res.json({ success: true, user: user });

    } catch (error) { res.status(500).json({ success: false, message: 'Lỗi cập nhật' }); }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, '-password').sort({ totalPoints: -1 });
        res.json({ success: true, users: users });
    } catch (err) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Server Backend đang chạy tại cổng http://localhost:${PORT}`); });