const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
require('dns').setDefaultResultOrder('ipv4first');

const app = express();
app.use(cors({ origin: '*' })); 
app.use(express.json()); 

// LINK MONGODB
const MONGO_URI = "mongodb+srv://nguyenanh:16102006@cluster0.iwcowsc.mongodb.net/TinhNguyenApp?retryWrites=true&w=majority"; 

mongoose.connect(MONGO_URI).then(() => console.log('DB Connected'));

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true, pool: true,
    auth: { user: 'anklee206@gmail.com', pass: 'neohvuwijoatsfrh' }
});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, default: '' },
  resetOtp: { type: String, default: '' },
  resetOtpExpiry: { type: Date, default: null },
  role: { type: String, default: 'user' },
  group: { type: String, default: '' },
  currentStreak: { type: Number, default: 0 },
  maxStreak: { type: Number, default: 0 },
  lostStreaks: { type: Number, default: 0 },
  totalCheckins: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  hasCheckedInToday: { type: Boolean, default: false },
  lastCheckinDateStr: { type: String, default: "" }, 
  history: [{ type: String }],
  dailyLogs: [{ date: String, q1: String, q2: String, q3: String, source: String, emotion: String }]
});

const User = mongoose.model('User', userSchema);

// HÀM KIỂM TRA VÀ RESET TRẠNG THÁI NGÀY MỚI (QUAN TRỌNG: SỬA LỖI KHÔNG CỘNG ĐIỂM)
function getDaysDiff(dateStr1, dateStr2) {
    if (!dateStr1 || !dateStr2) return 0;
    const d1 = new Date(dateStr1); const d2 = new Date(dateStr2);
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

async function checkAndResetStreak(user, localDate) {
    let justLostStreak = false;
    let lastDateStr = user.lastCheckinDateStr;
    if (!lastDateStr && user.history && user.history.length > 0) { lastDateStr = user.history[user.history.length - 1]; }
    
    if (lastDateStr && localDate) {
        const daysPassed = getDaysDiff(lastDateStr, localDate);
        if (daysPassed > 1 && user.currentStreak > 0) {
            user.currentStreak = 0; user.lostStreaks += 1; user.hasCheckedInToday = false; justLostStreak = true;
        } else if (daysPassed >= 1 && user.hasCheckedInToday) { 
            user.hasCheckedInToday = false; // Mở khóa cho ngày mới
        }
    } else if (!lastDateStr && user.hasCheckedInToday) { 
        user.hasCheckedInToday = false; 
    }
    return justLostStreak;
}

// API QUẢN TRỊ
app.post('/api/admin/reset-system', async (req, res) => {
    try {
        const { adminUser, adminPass } = req.body;
        if (adminUser !== "Nguyên Anh" || adminPass !== "16102006") return res.status(403).json({ success: false, message: "Bạn không có quyền!" });
        await User.updateMany({}, { $set: { currentStreak: 0, maxStreak: 0, totalCheckins: 0, totalPoints: 0, lostStreaks: 0, history: [], hasCheckedInToday: false, lastCheckinDateStr: "" } });
        res.json({ success: true, message: "Đã reset toàn bộ hệ thống về 0 thành công!" });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email, group } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ success: false, message: 'Tên tài khoản đã tồn tại' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword, email, role: (username === "Nguyên Anh" ? 'admin' : 'user'), group });
    await newUser.save();
    res.json({ success: true, user: newUser });
  } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password, localDate } = req.body; 
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ success: false, message: 'Tài khoản không tồn tại' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Sai mật khẩu' });
    
    // Check reset qua ngày
    let justLostStreak = false;
    if (localDate) { justLostStreak = await checkAndResetStreak(user, localDate); await user.save(); }
    const userObj = user.toObject(); userObj.justLostStreak = justLostStreak;
    res.json({ success: true, user: userObj });
  } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/update-profile', async (req, res) => {
    try {
        const { userId, newUsername, newEmail, newPassword } = req.body;
        const user = await User.findById(userId);
        if (newUsername) {
            const dup = await User.findOne({ username: newUsername });
            if (dup && dup._id.toString() !== userId) return res.status(400).json({ success: false, message: "Tên này đã có người dùng!" });
            user.username = newUsername;
        }
        if (newEmail) user.email = newEmail;
        if (newPassword) user.password = await bcrypt.hash(newPassword, 10);
        await user.save(); res.json({ success: true, user });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, message: 'Email không tồn tại!' });
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.resetOtp = otp; user.resetOtpExpiry = new Date(Date.now() + 15 * 60000); await user.save();
        res.json({ success: true, message: "Mã đang gửi!" });
        transporter.sendMail({ from: '"Cổng Tĩnh Nguyện" <anklee206@gmail.com>', to: user.email, subject: 'Mã OTP Khôi Phục', text: `Mã của bạn là: ${otp}` });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const user = await User.findOne({ email });
        if (user.resetOtp !== otp || user.resetOtpExpiry < new Date()) return res.status(400).json({ success: false, message: 'Mã sai/hết hạn' });
        user.password = await bcrypt.hash(newPassword, 10); user.resetOtp = ''; await user.save(); res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/update-streak', async (req, res) => {
    try {
        const { userId, localDate, logData } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
        
        // VÁ LỖI NGÀY MỚI TRƯỚC KHI CỘNG ĐIỂM
        await checkAndResetStreak(user, localDate);

        if (!user.hasCheckedInToday) {
            user.currentStreak++; user.maxStreak = Math.max(user.maxStreak, user.currentStreak);
            user.totalCheckins++; user.totalPoints++; user.hasCheckedInToday = true; user.lastCheckinDateStr = localDate;
            if(!user.history) user.history = []; if(!user.history.includes(localDate)) user.history.push(localDate);
            if(!user.dailyLogs) user.dailyLogs = [];
            user.dailyLogs.unshift({ date: localDate, ...logData });
            await user.save();
        }
        res.json({ success: true, user });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/update-group', async (req, res) => {
    try {
        const { userId, group } = req.body;
        const user = await User.findById(userId); user.group = group; await user.save(); res.json({ success: true, user });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/users', async (req, res) => {
    const users = await User.find({}, '-password').sort({ totalPoints: -1 }); res.json({ success: true, users });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));