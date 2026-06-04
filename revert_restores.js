const mongoose = require('mongoose');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

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

function getDaysDiff(dateStr1, dateStr2) {
    if (!dateStr1 || !dateStr2) return 0;
    const d1 = new Date(dateStr1);
    const d2 = new Date(dateStr2);
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

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

function calculateLostStreaks(history, todayStr) {
    if (!history || history.length === 0) return 0;
    
    // Sort unique history dates ascending
    const sorted = Array.from(new Set(history)).sort();
    let lostCount = 0;

    // 1. Gaps between consecutive check-ins
    for (let i = 0; i < sorted.length - 1; i++) {
        const diff = getDaysDiff(sorted[i], sorted[i+1]);
        if (diff > 1) {
            lostCount++;
        }
    }

    // 2. Gap after the last check-in to today
    const lastCheckin = sorted[sorted.length - 1];
    const diffToToday = getDaysDiff(lastCheckin, todayStr);
    if (diffToToday > 1) {
        lostCount++;
    }

    return lostCount;
}

async function run() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("Connected to MongoDB successfully.");

        const users = await User.find({});
        console.log(`Found ${users.length} total users.`);

        const todayStr = getLocalTodayStr();
        console.log(`Today's date is calculated as: ${todayStr}`);

        let revertedRestoresCount = 0;
        let correctedStatsCount = 0;

        for (const user of users) {
            const hasRestoreLog = user.dailyLogs.some(log => log.q1 === 'Khôi phục chuỗi tự động');
            const hasRestoreDate = !!user.lastRestoreDateStr;
            const needsRevert = hasRestoreLog || hasRestoreDate;

            // 1. Clean logs and history if user restored streak
            let cleanedLogs = [...user.dailyLogs];
            let cleanedHistory = [...user.history];
            let lastRestoreDateStr = user.lastRestoreDateStr || "";

            if (needsRevert) {
                cleanedLogs = user.dailyLogs.filter(log => log.q1 !== 'Khôi phục chuỗi tự động');
                const actualDatesSet = new Set(cleanedLogs.map(log => log.date));
                cleanedHistory = user.history.filter(dateStr => actualDatesSet.has(dateStr));
                lastRestoreDateStr = "";
            }

            // Ensure history is sorted and unique
            cleanedHistory = Array.from(new Set(cleanedHistory)).sort();

            // 2. Calculate correct stats based on cleaned data
            const targetTotalCheckins = cleanedHistory.length;
            const targetTotalPoints = cleanedHistory.length;
            const targetCurrentStreak = calculateCurrentStreak(cleanedHistory, todayStr);
            const targetMaxStreak = calculateMaxStreak(cleanedHistory);
            const targetLostStreaks = calculateLostStreaks(cleanedHistory, todayStr);
            const targetHasCheckedInToday = cleanedHistory.includes(todayStr);

            // Check if updates are needed
            const isRestoreReverted = needsRevert;
            const isStatsMismatch = 
                user.totalCheckins !== targetTotalCheckins ||
                user.totalPoints !== targetTotalPoints ||
                user.currentStreak !== targetCurrentStreak ||
                user.maxStreak !== targetMaxStreak ||
                user.lostStreaks !== targetLostStreaks ||
                user.hasCheckedInToday !== targetHasCheckedInToday ||
                user.lastRestoreDateStr !== lastRestoreDateStr;

            if (isRestoreReverted || isStatsMismatch) {
                console.log(`\n----------------------------------------`);
                console.log(`User: ${user.username}`);
                
                if (isRestoreReverted) {
                    console.log(`⚠️  Reverting streak restoration...`);
                    revertedRestoresCount++;
                }
                if (isStatsMismatch && !isRestoreReverted) {
                    console.log(`🔧 Correcting stats mismatch...`);
                    correctedStatsCount++;
                }

                console.log(`  - currentStreak: ${user.currentStreak} -> ${targetCurrentStreak}`);
                console.log(`  - maxStreak: ${user.maxStreak} -> ${targetMaxStreak}`);
                console.log(`  - totalCheckins: ${user.totalCheckins} -> ${targetTotalCheckins}`);
                console.log(`  - totalPoints: ${user.totalPoints} -> ${targetTotalPoints}`);
                console.log(`  - lostStreaks: ${user.lostStreaks} -> ${targetLostStreaks}`);
                console.log(`  - hasCheckedInToday: ${user.hasCheckedInToday} -> ${targetHasCheckedInToday}`);
                if (user.lastRestoreDateStr !== lastRestoreDateStr) {
                    console.log(`  - lastRestoreDateStr: "${user.lastRestoreDateStr}" -> "${lastRestoreDateStr}"`);
                }

                // Apply changes
                user.dailyLogs = cleanedLogs;
                user.history = cleanedHistory;
                user.totalCheckins = targetTotalCheckins;
                user.totalPoints = targetTotalPoints;
                user.currentStreak = targetCurrentStreak;
                user.maxStreak = targetMaxStreak;
                user.lostStreaks = targetLostStreaks;
                user.hasCheckedInToday = targetHasCheckedInToday;
                user.lastRestoreDateStr = lastRestoreDateStr;

                await user.save();
                console.log(`✅ Successfully updated ${user.username}`);
            }
        }

        console.log(`\n========================================`);
        console.log(`Summary of execution:`);
        console.log(`  - Reverted restorations: ${revertedRestoresCount} users`);
        console.log(`  - Corrected stats/lostStreaks: ${correctedStatsCount} users`);
        console.log(`========================================`);

    } catch (e) {
        console.error("Error during run:", e);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB.");
    }
}

run();
