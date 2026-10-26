# 🧾 Land-Ledger

**Land-Ledger** is a decentralized land registration and verification platform built using **blockchain technology**. It ensures **secure**, **transparent**, and **tamper-proof** land ownership records — with RESTful API endpoints exposed for seamless integration by real estate agencies, government bodies, and individual users.

---

## 🔍 Key Features

🏠 **Register and Verify Land Ownership**
Securely register land parcels and verify ownership through immutable smart contracts.

🛡️ **Fraud Prevention**
Eliminates double registrations and forgery using blockchain-backed proofs.

📄 **RESTful API with Swagger UI**
Easily test and integrate endpoints through interactive documentation.

⚙️ **Modular Architecture**
Smart contract logic and API layers are cleanly separated for easy upgrades.

🗃️ **Blockchain-Based Storage**
All land data is stored and validated on-chain (Ethereum), ensuring auditability.

---

## 🧑‍💼 How Realtors Can Use It

| Realtor Task               | Land-Ledger Support                                                          |
| -------------------------- | ---------------------------------------------------------------------------- |
| Registering New Properties | Register land via `/registerLand` and store data securely on the blockchain. |
| Verifying Ownership        | Instantly check ownership with `/verifyOwner/:address` or `/land/:id`.       |
| Fraud & Dispute Reduction  | Immutable smart contract data ensures trust in ownership records.            |
| Future Transfers (Roadmap) | Will support ownership transfers and historical lookups.                     |

---

## 📁 Project Structure

```bash
Land-Ledger/
├── index.js           # Blockchain interaction logic (Web3.js + smart contract)
├── server.js          # Express RESTful API server
├── networks.js        # Web3 and Ethereum network configuration
├── swagger.json       # API documentation spec for Swagger UI
├── package.json       # Project metadata and dependencies
├── README.md          # Project overview and usage
└── todo.md            # Feature roadmap
```

---

## ⚙️ How It Works

1. Users interact with REST API endpoints exposed via `server.js`.
2. Backend functions in `index.js` trigger smart contract methods.
3. Web3.js communicates with the Ethereum network to:

   * Register land
   * Verify ownership
   * Fetch land details
4. Swagger UI provides a testable API interface at `/docs`.

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/Land-Ledger.git
cd Land-Ledger
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Server

```bash
node server.js
```

Visit [http://localhost:3000](http://localhost:3000)

---

## 📚 API Documentation (Swagger UI)

* Visit: [http://localhost:3000/docs](http://localhost:3000/docs)
* Interact with endpoints to:

  * Register land
  * View land details
  * Verify ownership

---

## 📌 Example API Endpoints

| Method | Endpoint                | Description                        |
| ------ | ----------------------- | ---------------------------------- |
| POST   | `/registerLand`         | Register a new land parcel         |
| GET    | `/land/:id`             | Fetch land details by land ID      |
| GET    | `/verifyOwner/:address` | Verify ownership by wallet address |

---

## 📦 Built With

* **Node.js** – Server runtime
* **Express.js** – REST API framework
* **Web3.js** – Blockchain communication
* **Ethereum** – Smart contract backend
* **Swagger** – API visualization & documentation

---

## ✅ Roadmap (`todo.md`)

* ✅ Build REST API with blockchain integration
* ⏳ Add frontend dashboard for land registry
* ⏳ Implement smart contract event listeners
* ⏳ Improve validation and error handling
* ⏳ Deploy to Ethereum testnet (Goerli)
* ⏳ Add ownership transfer functionality
* ⏳ IPFS integration for document uploads
* ⏳ User/realtor authentication & role-based access

---

## 👤 Author

**SamOpera (Samson Olakeye)**
🔗 [GitHub](https://github.com/SamOpera) | [LinkedIn](https://www.linkedin.com/in/samsonolakeye)

---

## 📬 Contributions & Feedback

Feel free to open issues or submit pull requests.
Want help extending this project with a frontend or advanced features like **title transfer**, **role-based dashboards**, or **IPFS document storage**? Let’s build it!
