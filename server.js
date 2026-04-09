const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors({ origin: '*' })); 
app.use(express.json()); 

// 🚨 THAY LINK MONGODB THẬT CỦA BẠN VÀO ĐÂY
const MONGO_URI = "mongodb+srv://nguyenanh:16102006@cluster0.iwcowsc.mongodb.net/TinhNguyenApp?retryWrites=true&w=majority"; 

mongoose.connect(MONGO_URI)
  .then(() => console.log('Đã kết nối Database thành công!'))
  .catch(err => console.log('Lỗi kết nối DB:', err));

// BỔ SUNG THÊM TRƯỜNG "group" VÀO SCHEMA
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  group: { type: String, default: '' }, // <-- TRƯỜNG MỚI ĐỂ LƯU NHÓM
  currentStreak: { type: Number, default: 0 },
  maxStreak: { type: Number, default: 0 },
  lostStreaks: { type: Number, default: 0 },
  totalCheckins: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  hasCheckedInToday: { type: Boolean, default: false },
  lastCheckinDateStr: { type: String, default: "" }, 
  history: [{ type: String }],
  dailyLogs: [{
      date: String,
      q1: String,
      q2: String,
      q3: String,
      source: String,
      emotion: String
  }]
});

const User = mongoose.model('User', userSchema);

function getDaysDiff(dateStr1, dateStr2) {
    if (!dateStr1 || !dateStr2) return 0;
    const d1 = new Date(dateStr1);
    const d2 = new Date(dateStr2);
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

async function checkAndResetStreak(user, localDate) {
    let justLostStreak = false;
    let lastDateStr = user.lastCheckinDateStr;
    if (!lastDateStr && user.history && user.history.length > 0) {
        lastDateStr = user.history[user.history.length - 1];
    }
    if (lastDateStr && localDate) {
        const daysPassed = getDaysDiff(lastDateStr, localDate);
        if (daysPassed > 1 && user.currentStreak > 0) {
            user.currentStreak = 0;
            user.lostStreaks += 1;
            user.hasCheckedInToday = false;
            justLostStreak = true;
        } else if (daysPassed >= 1 && user.hasCheckedInToday) {
            user.hasCheckedInToday = false;
        }
    } else if (!lastDateStr && user.hasCheckedInToday) {
        user.hasCheckedInToday = false;
    }
    return justLostStreak;
}

app.get('/', (req, res) => res.status(200).send('Server Awake!'));

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

app.post('/api/login', async (req, res) => {
  try {
    const { username, password, localDate } = req.body; 
    const user = await User.findOne({ username: username });
    if (!user) return res.status(400).json({ success: false, message: 'Tài khoản không tồn tại' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Sai mật khẩu' });

    const justLostStreak = await checkAndResetStreak(user, localDate);
    await user.save();
    const userResponse = user.toObject();
    userResponse.justLostStreak = justLostStreak;
    res.json({ success: true, user: userResponse });
  } catch (error) { res.status(500).json({ success: false, message: 'Lỗi server' }); }
});

// API MỚI: LƯU THÔNG TIN NHÓM NHỎ
app.post('/api/update-group', async (req, res) => {
    try {
        const { userId, group } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
        
        user.group = group;
        await user.save();
        res.json({ success: true, user: user });
    } catch (error) { res.status(500).json({ success: false, message: 'Lỗi cập nhật nhóm' }); }
});

app.post('/api/update-streak', async (req, res) => {
    try {
        const { userId, action, localDate, logData } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });

        await checkAndResetStreak(user, localDate);

        if (action === 'checkin' && !user.hasCheckedInToday) {
            user.currentStreak++;
            user.maxStreak = Math.max(user.maxStreak, user.currentStreak);
            user.totalCheckins++;
            user.totalPoints++;
            user.hasCheckedInToday = true;
            user.lastCheckinDateStr = localDate;
            
            if (!user.history) user.history = [];
            if (!user.history.includes(localDate)) user.history.push(localDate);

            if (logData) {
                if (!user.dailyLogs) user.dailyLogs = [];
                user.dailyLogs.unshift({
                    date: localDate,
                    q1: logData.q1,
                    q2: logData.q2,
                    q3: logData.q3,
                    source: logData.source,
                    emotion: logData.emotion
                });
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
app.listen(PORT, () => { console.log(`Server Backend đang chạy tại cổng ${PORT}`); });