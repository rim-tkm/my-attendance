/**
 * 初期ユーザーを作成して data/users.json を生成します。
 * 実行: node scripts/seed-users.js
 */
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const SALT_ROUNDS = 10;

const initialUsers = [
  { loginId: "admin", name: "管理者", password: "admin123" },
  { loginId: "tomoyohayakawa", name: "tomoyohayakawa", password: "tomoyohayakawa" },
  { loginId: "namiwatanabe", name: "namiwatanabe", password: "namiwatanabe" },
  { loginId: "kikuesimizu", name: "kikuesimizu", password: "kikuesimizu" },
  { loginId: "tenukin", name: "tenukin", password: "tenukin" },
  { loginId: "risakondou", name: "risakondou", password: "risakondou" },
  { loginId: "asukanoro", name: "asukanoro", password: "asukanoro" },
  { loginId: "satomiyoshimura", name: "satomiyoshimura", password: "satomiyoshimura" },
  { loginId: "risasuzuki", name: "risasuzuki", password: "risasuzuki" },
  { loginId: "keikokiuchi", name: "keikokiuchi", password: "keikokiuchi" },
  { loginId: "chiakiyamamoto", name: "chiakiyamamoto", password: "chiakiyamamoto" },
  { loginId: "megumiozaki", name: "megumiozaki", password: "megumiozaki" },
  { loginId: "ryokato", name: "ryokato", password: "ryokato" },
  { loginId: "akiyoshiito", name: "akiyoshiito", password: "akiyoshiito" },
  { loginId: "kazukihara", name: "kazukihara", password: "kazukihara" },
  { loginId: "tiekoyamamoto", name: "tiekoyamamoto", password: "tiekoyamamoto" },
  { loginId: "takayukikuribayasi", name: "takayukikuribayasi", password: "takayukikuribayasi" },
];

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const users = await Promise.all(
    initialUsers.map(async (u, i) => ({
      id: `user-${i + 1}`,
      loginId: u.loginId,
      name: u.name,
      passwordHash: await bcrypt.hash(u.password, SALT_ROUNDS),
    }))
  );

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
  console.log("Created", USERS_FILE);
  console.log("Users:", initialUsers.map((u) => u.loginId).join(", "));
  console.log("admin のパスワード: admin123 / その他メンバー: ログインIDとパスワードは同じ");
}

main().catch(console.error);
