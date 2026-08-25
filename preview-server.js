const express = require('express');
const path = require('path');

const app = express();
const publicDir = path.join(__dirname, 'public');
const salesPage = path.join(publicDir, 'apresentacao.html');

// A raiz do serviço de preview deve SEMPRE mostrar a página de apresentação.
// Esta rota precisa vir antes do express.static para impedir que public/index.html
// (o app principal) seja servido automaticamente na URL "/".
app.get('/', (req, res) => res.sendFile(salesPage));
app.get('/apresentacao', (req, res) => res.sendFile(salesPage));
app.get('/apresentacao.html', (req, res) => res.sendFile(salesPage));

// Assets e demais arquivos públicos continuam disponíveis para a apresentação.
app.use(express.static(publicDir, { index: false }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Preview Sifia em http://localhost:${PORT}`));
