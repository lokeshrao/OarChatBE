const server = require('./server');  // Assuming 'server' is CommonJS


  server.listen(8080, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});