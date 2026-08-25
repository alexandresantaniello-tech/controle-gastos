const express = require('express');
const path = require('path');
const app = express();
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'apresentacao.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Preview Sifia em http://localhost:${PORT}`));
