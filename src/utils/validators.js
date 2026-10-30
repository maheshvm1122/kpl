const mongoose = require('mongoose');
const AppError = require('./AppError');

const CRICKET_STYLES = ['Batting', 'Bowling', 'All-Rounder', 'Wicket-keeper'];
const PAYMENT_STATUS = ['Unpaid', 'Paid'];
const SOLD_STATUS = ['NotSold', 'Sold'];
const ROLES = ['Admin', 'Auctioneer'];
const USER_STATUS = ['Active', 'Inactive'];

const MOBILE_REGEX = /^[6-9]\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeMobile = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  // Accept +91 / 0 prefixes typed by users
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
};

const isValidMobile = (value) => MOBILE_REGEX.test(value);

const assertObjectId = (id, label = 'id') => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
};

const toPositiveAmount = (value, label = 'Amount') => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(`${label} must be greater than 0`, 400);
  }
  return Math.round(amount);
};

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MAX_PAGE_SIZE = 300;

const parsePagination = (query, defaultLimit = 20) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

module.exports = {
  CRICKET_STYLES,
  PAYMENT_STATUS,
  SOLD_STATUS,
  ROLES,
  USER_STATUS,
  EMAIL_REGEX,
  normalizeMobile,
  isValidMobile,
  assertObjectId,
  toPositiveAmount,
  escapeRegex,
  parsePagination,
};
