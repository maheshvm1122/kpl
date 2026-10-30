const mongoose = require('mongoose');

/** App-wide settings changed from the admin portal (e.g. registration open / closed). */
const settingSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // setting key
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const Setting = mongoose.model('Setting', settingSchema);

Setting.KEYS = { REGISTRATION_OPEN: 'registrationOpen' };

Setting.getValue = async function getValue(key, defaultValue) {
  const doc = await Setting.findById(key).lean();
  return doc ? doc.value : defaultValue;
};

Setting.setValue = function setValue(key, value, userId) {
  return Setting.findOneAndUpdate(
    { _id: key },
    { value, updatedBy: userId || null },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).populate('updatedBy', 'name username');
};

/** Registration is open unless an admin has closed it. */
Setting.isRegistrationOpen = async function isRegistrationOpen() {
  return (await Setting.getValue(Setting.KEYS.REGISTRATION_OPEN, true)) !== false;
};

module.exports = Setting;
