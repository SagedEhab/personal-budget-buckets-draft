// Runs this service alone on your PC: npm run dev  ->  http://localhost:3001
// To run ALL services behind one URL (like API Gateway), use: node infra/local-gateway.js
const app = require('./app');

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`pb-auth-service listening on http://localhost:${PORT}`);
});
