const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();

// Cho phép GitHub Pages của bạn gọi API từ server này
// Sau này đưa lên web thật, bạn có thể thay '*' bằng 'https://nguynank.github.io'
app.use(cors({ origin: '*' })); 
app.use(express.json()); 

// --- 1. KẾT NỐI DATABASE MONGODB ---
// BẠN SẼ THAY ĐƯỜNG LINK CỦA BẠN VÀO ĐOẠN CHỮ NÀY LÁT NỮA
const MONGO_URI = "mongodb://nguyenanh:16102006@ac-go4boqu-shard-00-00.iwcowsc.mongodb.net:27017,ac-go4boqu-shard-00-01.iwcowsc.mongodb.net:27017,ac-go4boqu-shard-00-02.iwcowsc.mongodb.net:27017/TinhNguyenApp?ssl=true&replicaSet=atlas-2vjpsc-shard-0&authSource=admin&appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Đã kết nối Database thành công!'))
  .catch(err => {
      console.log('❌ Lỗi kết nối DB chi tiết:');
      console.log('- Mã lỗi:', err.code);
      console.log('- Nguyên nhân:', err.cause);
  });

// --- 2. TẠO KHUÔN MẪU DỮ LIỆU NGƯỜI DÙNG ---
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

// --- 3. CÁC API (ĐẦU BẾP XỬ LÝ DỮ LIỆU) ---

// API Kiểm tra server có đang sống không
app.get('/', (req, res) => {
    res.send('Server Chuỗi Tĩnh Nguyện đang hoạt động bình thường!');
});

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

// API Lấy danh sách User cho Admin
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({});
        res.json({ success: true, users: users });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Lỗi lấy dữ liệu' });
    }
});

// --- 4. KHỞI ĐỘNG SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server Backend đang chạy tại cổng http://localhost:${PORT}`);
});
// API Lấy danh sách tất cả người dùng (Dành cho Admin)
app.get('/api/users', async (req, res) => {
  try {
    // Tìm tất cả user và sắp xếp theo Tổng điểm giảm dần (-1)
    const users = await User.find({}).sort({ totalPoints: -1 }); 
    res.json({ success: true, users: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi lấy dữ liệu' });
  }
});