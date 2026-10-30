const multer = require('multer');

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  let status = err.statusCode || 500;
  let message = err.message || 'Something went wrong';

  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large. Maximum size is 5 MB' : 'Photo upload failed';
  } else if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || {})[0];
    const labels = { mobile: 'mobile number', username: 'username', nameKey: 'team name', slNo: 'S.L. No' };
    message = `This ${labels[field] || field || 'value'} is already in use`;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid request body';
  }

  if (status >= 500) {
    console.error(err);
    message = 'Something went wrong on the server. Please try again';
  }

  res.status(status).json({ success: false, message, ...(err.details ? { details: err.details } : {}) });
};
