const mongoose = require('mongoose');

const MONGO_URI = "mongodb+srv://nguyenanh:16102006@cluster0.iwcowsc.mongodb.net/TinhNguyenApp?retryWrites=true&w=majority";

const userSchema = new mongoose.Schema({
    username: String,
    role: String,
    group: String,
    currentStreak: Number,
    maxStreak: Number,
    lostStreaks: Number,
    totalCheckins: Number,
    totalPoints: Number,
    hasCheckedInToday: Boolean,
    lastCheckinDateStr: String,
    history: [String],
    dailyLogs: [{ date: String, q1: String, q2: String, q3: String, source: String, emotion: String }],
    registerDateStr: String,
    lastRestoreDateStr: String
});

const User = mongoose.model('User', userSchema);

function getLocalTodayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
}

function calculateMaxStreak(history) {
    if (!history || history.length === 0) return 0;
    const sorted = Array.from(new Set(history)).sort();
    let maxStreak = 0;
    let currentStreak = 0;
    let prevDate = null;

    for (const dateStr of sorted) {
        const currentDate = new Date(dateStr);
        if (prevDate === null) {
            currentStreak = 1;
        } else {
            const diffTime = Math.abs(currentDate - prevDate);
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
                currentStreak++;
            } else if (diffDays > 1) {
                currentStreak = 1;
            }
        }
        if (currentStreak > maxStreak) {
            maxStreak = currentStreak;
        }
        prevDate = currentDate;
    }
    return maxStreak;
}

function calculateCurrentStreak(history, todayStr) {
    if (!history || history.length === 0) return 0;
    const historySet = new Set(history);
    let tempStreak = 0;
    let checkDate = new Date(todayStr);

    if (!historySet.has(todayStr)) {
        checkDate.setDate(checkDate.getDate() - 1);
    }

    for (let i = 0; i < 365; i++) {
        const dStr = checkDate.getFullYear() + "-" + String(checkDate.getMonth() + 1).padStart(2, '0') + "-" + String(checkDate.getDate()).padStart(2, '0');
        if (historySet.has(dStr)) {
            tempStreak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            break;
        }
    }
    return tempStreak;
}

async function run() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("Connected to MongoDB successfully.");

        const users = await User.find({});
        console.log(`Found ${users.length} total users.`);

        const todayStr = getLocalTodayStr();
        let revertCount = 0;

        for (const user of users) {
            const hasRestoreLog = user.dailyLogs.some(log => log.q1 === 'Khôi phục chuỗi tự động');
            const hasRestoreDate = !!user.lastRestoreDateStr;

            if (hasRestoreLog || hasRestoreDate) {
                console.log(`\n----------------------------------------`);
                console.log(`User: ${user.username}`);
                console.log(`Old state:`);
                console.log(`  - currentStreak: ${user.currentStreak}`);
                console.log(`  - maxStreak: ${user.maxStreak}`);
                console.log(`  - totalCheckins: ${user.totalCheckins}`);
                console.log(`  - totalPoints: ${user.totalPoints}`);
                console.log(`  - lastRestoreDateStr: ${user.lastRestoreDateStr}`);
                console.log(`  - history length: ${user.history.length}`);
                console.log(`  - dailyLogs length: ${user.dailyLogs.length}`);

                // Reconstruct data
                // 1. Clean dailyLogs (remove 'Khôi phục chuỗi tự động' logs)
                const cleanedLogs = user.dailyLogs.filter(log => log.q1 !== 'Khôi phục chuỗi tự động');

                // 2. Clean history: only keep dates that have a corresponding log in cleanedLogs
                const actualDatesSet = new Set(cleanedLogs.map(log => log.date));
                const cleanedHistory = user.history.filter(dateStr => actualDatesSet.has(dateStr));

                // 3. Recalculate stats
                const newTotalCheckins = cleanedHistory.length;
                const newTotalPoints = cleanedHistory.length;
                const newCurrentStreak = calculateCurrentStreak(cleanedHistory, todayStr);
                const newMaxStreak = calculateMaxStreak(cleanedHistory);

                console.log(`New state (Reconstructed):`);
                console.log(`  - currentStreak: ${newCurrentStreak}`);
                console.log(`  - maxStreak: ${newMaxStreak}`);
                console.log(`  - totalCheckins: ${newTotalCheckins}`);
                console.log(`  - totalPoints: ${newTotalPoints}`);
                console.log(`  - lastRestoreDateStr: ""`);
                console.log(`  - history length: ${cleanedHistory.length}`);
                console.log(`  - dailyLogs length: ${cleanedLogs.length}`);

                // Perform update
                user.history = cleanedHistory.sort();
                user.dailyLogs = cleanedLogs;
                user.totalCheckins = newTotalCheckins;
                user.totalPoints = newTotalPoints;
                user.currentStreak = newCurrentStreak;
                user.maxStreak = newMaxStreak;
                user.lastRestoreDateStr = "";

                // Check if user has checked in today (if today's date is in actual dates)
                user.hasCheckedInToday = actualDatesSet.has(todayStr);

                await user.save();
                console.log(`✅ Successfully reverted user ${user.username}`);
                revertCount++;
            }
        }

        console.log(`\nReverted ${revertCount} users in total.`);
    } catch (e) {
        console.error("Error occurred:", e);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB.");
    }
}

run();
