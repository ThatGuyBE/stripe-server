// api/test.js
module.exports = (req, res) => {
	return res.status(200).json({ ok: true, method: req.method });
};