# 💰 Shared Expenses App

A full-stack **Expense Sharing & Settlement Application** built with **Express.js** and **SQLite** for managing shared expenses among flatmates or groups.

It supports secure authentication, group management, expense tracking, settlements, CSV imports with anomaly detection, balance summaries, and detailed ledger history.

---

## 🚀 Features

* 🔐 User Authentication (Login)
* 👥 Group-based Expense Management
* 📅 Date-based Group Membership Tracking
* 💸 Add & Split Expenses
* 🤝 Settlement Recording
* 📊 Balance Summary for Each Member
* 📜 Individual Ledger History
* 📂 CSV Expense Import
* ⚠️ Import Validation & Anomaly Report Generation
* 💱 Automatic USD → INR Conversion Support
* 🗄️ SQLite Database with Auto Initialization

---

## 🛠️ Tech Stack

| Technology      | Purpose              |
| --------------- | -------------------- |
| Node.js         | Runtime Environment  |
| Express.js      | Backend Framework    |
| SQLite          | Lightweight Database |
| EJS/HTML        | Server-side Views    |
| Express Session | Authentication       |
| Multer          | CSV File Upload      |

---

## 📁 Project Structure

```
project/
│
├── data/
│   └── app.db
├── uploads/
├── routes/
├── views/
├── public/
├── AI_USAGE.md
├── package.json
└── README.md
```

---

# ⚙️ Installation

Clone the repository:

```bash
git clone <repository-url>
cd shared-expenses-app
```

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
```

Application will be available at:

```
http://localhost:3000
```

---

# 🔑 Demo Credentials

| Email                                     | Password    |
| ----------------------------------------- | ----------- |
| [aisha@flat.test](mailto:aisha@flat.test) | password123 |

---

# 🗃️ Database

The application automatically creates:

```
data/app.db
```

To reset all data:

```bash
Delete data/app.db
Restart the application
```

A fresh database will be generated automatically.

---

# 📥 Importing CSV Expenses

1. Login to the application.
2. Open the desired Flatmates group.
3. Upload the `expenses_export.csv` file.
4. Provide a default USD → INR exchange rate if required.
5. Submit the import.
6. Review the generated Import Report for anomalies or skipped records.

### Supported CSV Headers

The importer automatically recognizes common column names including:

* Date
* Paid By
* Split Type
* Participants
* Split Details
* Amount
* Currency

No manual preprocessing of the CSV file is required.

---

# 📈 Reports

The application generates:

* Expense History
* Balance Summary
* Settlement Records
* Import Anomaly Report
* Per-user Ledger Trace

---

# 🧪 Running Tests

```bash
npm test
```

---

# 🤖 AI Assistance

This project was developed with assistance from **OpenAI Codex** during implementation and debugging.

Development notes and AI interactions are documented in:

```
AI_USAGE.md
```

---

# ☁️ Deployment

The application can be deployed on:

* Render
* Railway
* Fly.io
* Vercel
* DigitalOcean
* Any Node.js-compatible VPS

### Environment Variables

```
PORT=3000
SESSION_SECRET=your_secret_key
DB_PATH=optional_database_path
```

---

# 📦 Vercel Notes

This project uses SQLite.

Since Vercel provides a read-only filesystem, the database is stored in:

```
/tmp
```

The database is **ephemeral**, meaning data may be lost after:

* Cold Starts
* Function Restarts
* Redeployments
* Instance Replacement

This setup is suitable for demonstrations and assignments but not for production use.

Deploy with:

```bash
npm install -g vercel

vercel --prod
```

Set the `SESSION_SECRET` environment variable in the Vercel dashboard.

---

# 📌 Future Enhancements

* Email Notifications
* Expense Categories
* Recurring Expenses
* Mobile Responsive UI
* Graphical Analytics Dashboard
* Multi-currency Support
* Export to PDF & Excel
* User Profile Management

---

# 📄 License

This project is intended for educational and assignment purposes.

---

## 👨‍💻 Author

Developed as a Full Stack Expense Sharing application using Express.js and SQLite, showcasing backend development, database management, CSV processing, and financial reconciliation workflows.
