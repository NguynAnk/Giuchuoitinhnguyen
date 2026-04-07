const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();

// Cấp quyền kết nối từ trang web của bạn
app.use(cors({ origin: '*' })); 
app.use(express.json());

// --- 1. KẾT NỐI DATABASE MONGODB ---
// ⚠️ QUAN TRỌNG: HÃY DÁN ĐƯỜNG LINK MONGODB CỦA BẠN (CHỨA MẬT KHẨU) VÀO TRONG DẤU NGOẶC KÉP BÊN DƯỚI:
const MONGO_URI = "mongodb+srv://nguyenanh:16102006@cluster0.iwcowsc.mongodb.net/TinhNguyenApp?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('Đã kết nối Database thành công!'))
  .catch(err => console.log('Lỗi kết nối DB:', err));

// --- 2. KHUÔN MẪU DỮ LIỆU ---
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  currentStreak: { type: Number, default: 0 },
  maxStreak: { type: Number, default: 0 },
  lostStreaks: { type: Number, default: 0 },
  totalCheckins: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  hasCheckedInToday: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

// --- 3. CÁC API XỬ LÝ (ĐẦU BẾP) ---

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
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// API Đăng nhập
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username });
    if (!user) return res.status(400).json({ success: false, message: 'Tài khoản không tồn tại' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Sai mật khẩu' });

    res.json({ success: true, user: user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// API Cập nhật trạng thái chuỗi (Điểm danh)
app.post('/api/update-streak', async (req, res) => {
    try {
        const { userId, action } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });

        if (action === 'checkin' && !user.hasCheckedInToday) {
            user.currentStreak++;
            user.maxStreak = Math.max(user.maxStreak, user.currentStreak);
            user.totalCheckins++;
            user.totalPoints++;
            if (user.currentStreak >= 3 && user.currentStreak % 3 === 0) user.totalPoints++;
            user.hasCheckedInToday = true;
        } 
        else if (action === 'undo' && user.hasCheckedInToday) {
            let oldStreak = user.currentStreak;
            user.currentStreak = Math.max(0, user.currentStreak - 1);
            user.totalCheckins = Math.max(0, user.totalCheckins - 1);
            user.totalPoints = Math.max(0, user.totalPoints - 1);
            if (oldStreak >= 3 && oldStreak % 3 === 0) user.totalPoints = Math.max(0, user.totalPoints - 1);
            user.hasCheckedInToday = false;
        }
        else if (action === 'miss' && !user.hasCheckedInToday && user.currentStreak > 0) {
            user.currentStreak = 0;
            user.lostStreaks++;
            user.hasCheckedInToday = false;
        }

        await user.save();
        res.json({ success: true, user: user });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Lỗi cập nhật' });
    }
});

// API Lấy danh sách tất cả người dùng (Dành cho Admin)
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}).sort({ totalPoints: -1 }); 
    res.json({ success: true, users: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi lấy dữ liệu' });
  }
});

// --- 4. KHỞI ĐỘNG SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server Backend đang chạy tại cổng http://localhost:${PORT}`);
});