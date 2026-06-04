const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// LẤY API KEY TỪ BIẾN MÔI TRƯỜNG CỦA RENDER
const BREVO_API_KEY = process.env.BREVO_API_KEY;

// LINK MONGODB
const MONGO_URI = "mongodb+srv://nguyenanh:16102006@cluster0.iwcowsc.mongodb.net/TinhNguyenApp?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI).then(() => {
    console.log('DB Connected');
    initSystem();
});

// ================= SCHEMA =================
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
    dailyLogs: [{ date: String, q1: String, q2: String, q3: String, source: String, emotion: String }],
    registerDateStr: { type: String, default: "" },
    lastRestoreDateStr: { type: String, default: "" }
});
const User = mongoose.model('User', userSchema);

const systemSchema = new mongoose.Schema({
    configId: { type: String, default: 'main' },
    quizPassage: { type: String, default: 'Ê-sai 26-40' },
    quizQuestion: { type: String, default: 'Nội dung câu đố Kinh Thánh: ___' },
    campaignStartDateStr: { type: String, default: '2026-05-20' }
});
const System = mongoose.model('System', systemSchema);

async function initSystem() {
    let sys = await System.findOne({ configId: 'main' });
    if (!sys) {
        sys = new System({ configId: 'main' });
        await sys.save();
    } else if (!sys.campaignStartDateStr) {
        sys.campaignStartDateStr = '2026-05-20';
        await sys.save();
    }
}

// ================= HÀM HỖ TRỢ =================
async function sendEmailViaBrevo(toEmail, subject, htmlContent) {
    if (!BREVO_API_KEY) {
        console.error("Thiếu BREVO_API_KEY trong biến môi trường!");
        throw new Error("Lỗi cấu hình máy chủ gửi mail.");
    }

    const emailData = {
        sender: { name: "Cổng Tĩnh Nguyện", email: "anklee206@gmail.com" },
        to: [{ email: toEmail }],
        subject: subject,
        htmlContent: htmlContent
    };

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json'
        },
        body: JSON.stringify(emailData)
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error("Lỗi gửi mail qua Brevo API:", errorData);
        throw new Error("Không thể gửi email.");
    }
    return true;
}

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
            user.hasCheckedInToday = false;
        }
    } else if (!lastDateStr && user.hasCheckedInToday) {
        user.hasCheckedInToday = false;
    }
    return justLostStreak;
}

// ================= API CHÍNH =================

app.get('/api/system', async (req, res) => {
    try {
        const sys = await System.findOne({ configId: 'main' });
        res.json({ success: true, system: sys });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/update-quiz', async (req, res) => {
    try {
        const { adminUser, passage, question } = req.body;
        if (adminUser !== "Nguyên Anh") return res.status(403).json({ success: false, message: "Không có quyền!" });

        let sys = await System.findOne({ configId: 'main' });
        if (!sys) sys = new System({ configId: 'main' });

        sys.quizPassage = passage;
        sys.quizQuestion = question;
        await sys.save();

        res.json({ success: true, system: sys });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/revoke-checkin', async (req, res) => {
    try {
        const { adminUser, targetUserId, dateStr } = req.body;
        if (adminUser !== "Nguyên Anh") return res.status(403).json({ success: false, message: "Không có quyền thực hiện!" });

        const user = await User.findById(targetUserId);
        if (!user) return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });

        user.history = user.history.filter(d => d !== dateStr);
        user.dailyLogs = user.dailyLogs.filter(l => l.date !== dateStr);

        user.totalCheckins = Math.max(0, user.totalCheckins - 1);
        user.totalPoints = Math.max(0, user.totalPoints - 1);

        const todayStr = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, '0') + "-" + String(new Date().getDate()).padStart(2, '0');
        if (dateStr === todayStr) {
            user.hasCheckedInToday = false;
        }

        let tempStreak = 0;
        let checkDate = new Date(todayStr);
        if (!user.history.includes(todayStr)) checkDate.setDate(checkDate.getDate() - 1);

        for (let i = 0; i < 365; i++) {
            const dStr = checkDate.getFullYear() + "-" + String(checkDate.getMonth() + 1).padStart(2, '0') + "-" + String(checkDate.getDate()).padStart(2, '0');
            if (user.history.includes(dStr)) {
                tempStreak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else { break; }
        }
        user.currentStreak = tempStreak;

        await user.save();
        res.json({ success: true, user });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

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
        const { username, password, email, group, localDate } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ success: false, message: 'Tên tài khoản đã tồn tại' });

        if (email) {
            const existingEmail = await User.findOne({ email });
            if (existingEmail) return res.status(400).json({ success: false, message: 'Email này đã được sử dụng cho một tài khoản khác!' });
        }

        const regDate = localDate || new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, '0') + "-" + String(new Date().getDate()).padStart(2, '0');
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            username,
            password: hashedPassword,
            email,
            role: (username === "Nguyên Anh" ? 'admin' : 'user'),
            group,
            registerDateStr: regDate
        });

        await newUser.save();
        res.json({ success: true, user: newUser });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password, localDate } = req.body;
        const user = await User.findOne({
            $or: [{ username: username }, { email: username }]
        });
        if (!user) return res.status(400).json({ success: false, message: 'Tài khoản hoặc Email không tồn tại' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: 'Sai mật khẩu' });

        let justLostStreak = false;
        if (localDate) { justLostStreak = await checkAndResetStreak(user, localDate); await user.save(); }
        const userObj = user.toObject(); userObj.justLostStreak = justLostStreak;
        res.json({ success: true, user: userObj });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/auto-login', async (req, res) => {
    try {
        const { userId, localDate } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false });

        let justLostStreak = false;
        if (localDate) { justLostStreak = await checkAndResetStreak(user, localDate); await user.save(); }
        const userObj = user.toObject(); userObj.justLostStreak = justLostStreak;
        res.json({ success: true, user: userObj });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/feedback', async (req, res) => {
    try {
        const { userId, content } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false });

        const htmlContent = `
            <h3>💡 Có một góp ý mới từ người dùng!</h3>
            <ul>
                <li><strong>Người dùng:</strong> ${user.username}</li>
                <li><strong>Nhóm:</strong> ${user.group || 'Chưa chọn'}</li>
                <li><strong>Email liên hệ:</strong> ${user.email || 'Không có'}</li>
            </ul>
            <h4>Nội dung góp ý:</h4>
            <p style="background: #f4f4f4; padding: 10px; border-left: 4px solid #007bff;">${content}</p>
        `;

        await sendEmailViaBrevo('anklee206@gmail.com', `💡 Góp ý từ ${user.username}`, htmlContent);
        res.json({ success: true, message: "Cảm ơn bạn đã đóng góp ý kiến!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi gửi góp ý." });
    }
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
        if (!user) return res.status(400).json({ success: false, message: 'Email này không tồn tại trong hệ thống!' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.resetOtp = otp;
        user.resetOtpExpiry = new Date(Date.now() + 15 * 60000);
        await user.save();

        const htmlContent = `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 500px; margin: auto; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #007bff; text-align: center;">Chuỗi Tĩnh Nguyện</h2>
                <p>Xin chào <strong>${user.username}</strong>,</p>
                <p>Bạn vừa yêu cầu khôi phục mật khẩu. Dưới đây là mã OTP của bạn:</p>
                <div style="text-align: center; margin: 20px 0;">
                    <span style="font-size: 28px; font-weight: bold; color: #d9534f; letter-spacing: 4px; padding: 10px 20px; background: #f9f9f9; border-radius: 4px;">${otp}</span>
                </div>
                <p style="font-size: 13px; color: #777;">Mã này sẽ hết hạn sau 15 phút. Nếu bạn không yêu cầu, xin hãy bỏ qua email này.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="font-size: 12px; color: #aaa; text-align: center;">Phước hạnh và bình an!</p>
            </div>
        `;

        await sendEmailViaBrevo(user.email, 'Mã OTP Khôi Phục Mật Khẩu', htmlContent);
        res.json({ success: true, message: "Đã gửi mã OTP! Hãy kiểm tra Hộp thư đến (và Hộp thư rác)." });

    } catch (error) {
        console.error("Lỗi quên mật khẩu:", error);
        res.status(500).json({ success: false, message: "Lỗi hệ thống máy chủ gửi mail!" });
    }
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

        await checkAndResetStreak(user, localDate);

        if (!user.hasCheckedInToday) {
            user.currentStreak++; user.maxStreak = Math.max(user.maxStreak, user.currentStreak);
            user.totalCheckins++; user.totalPoints++; user.hasCheckedInToday = true; user.lastCheckinDateStr = localDate;
            if (!user.history) user.history = []; if (!user.history.includes(localDate)) user.history.push(localDate);
            if (!user.dailyLogs) user.dailyLogs = [];
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

app.post('/api/system/stats', async (req, res) => {
    try {
        const { localDate } = req.body;
        const users = await User.find({}, '-password');

        if (users.length === 0) {
            return res.json({ success: true, totalCompleted: 0, totalUncompleted: 0, daily: [] });
        }

        let earliestDateStr = localDate;
        users.forEach(u => {
            if (u.registerDateStr && u.registerDateStr < earliestDateStr) {
                earliestDateStr = u.registerDateStr;
            }
            u.history.forEach(d => {
                if (d < earliestDateStr) earliestDateStr = d;
            });
        });

        function formatDate(d) {
            return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
        }

        const dates = [];
        let current = new Date(earliestDateStr);
        const end = new Date(localDate);
        while (current <= end) {
            dates.push(formatDate(current));
            current.setDate(current.getDate() + 1);
        }
        dates.reverse();

        let totalCompletedOverall = 0;
        let totalUncompletedOverall = 0;
        const dailyStats = [];

        dates.forEach(date => {
            const completedUsers = [];
            const uncompletedUsers = [];

            users.forEach(u => {
                const regDate = u.registerDateStr || earliestDateStr;
                if (regDate <= date) {
                    if (u.history && u.history.includes(date)) {
                        completedUsers.push(u.username);
                    } else {
                        uncompletedUsers.push(u.username);
                    }
                }
            });

            const compCount = completedUsers.length;
            const uncompCount = uncompletedUsers.length;

            totalCompletedOverall += compCount;
            totalUncompletedOverall += uncompCount;

            dailyStats.push({
                date,
                completedCount: compCount,
                uncompletedCount: uncompCount,
                completedUsers,
                uncompletedUsers
            });
        });

        res.json({
            success: true,
            totalCompleted: totalCompletedOverall,
            totalUncompleted: totalUncompletedOverall,
            daily: dailyStats
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));