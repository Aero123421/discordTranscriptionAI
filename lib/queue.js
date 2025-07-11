const path = require('node:path');
const fs = require('node:fs');

function better(db) {
    return db;
}

function defineQueue({ connection }) {
    const db = connection;
    db.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const add = (name, data) => {
        const stmt = db.prepare('INSERT INTO jobs (name, data) VALUES (?, ?)');
        stmt.run(name, JSON.stringify(data));
    };

    return { add };
}

function defineWorker(name, handler, { queue }) {
    const db = queue.connection;

    const processJobs = async () => {
        const stmt = db.prepare("SELECT * FROM jobs WHERE name = ? AND status = 'pending' ORDER BY id ASC LIMIT 1");
        const job = stmt.get(name);

        if (job) {
            const updateStmt = db.prepare("UPDATE jobs SET status = 'processing' WHERE id = ?");
            updateStmt.run(job.id);

            try {
                const jobData = JSON.parse(job.data);
                await handler({ data: jobData, id: job.id });
                const doneStmt = db.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?");
                doneStmt.run(job.id);
            } catch (error) {
                console.error(`Error processing job ${job.id}:`, error);
                const errorStmt = db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?");
                errorStmt.run(job.id);
            }
        }
    };

    setInterval(processJobs, 5000); // Check for new jobs every 5 seconds
}

module.exports = { better, defineQueue, defineWorker };
