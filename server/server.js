const http = require('http');

module.exports.createLandingPage = () => {
    // try {
        const port = parseInt(process.env.PORT, 10);
        const html = require('fs').readFileSync('./index.html');
        http.createServer((req, res) => {
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(html);
        }).listen(port);
    // } catch {}
};