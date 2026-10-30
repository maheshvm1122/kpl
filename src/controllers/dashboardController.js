const Player = require('../models/Player');
const Team = require('../models/Team');
const asyncHandler = require('../utils/asyncHandler');

const TIMEZONE = 'Asia/Kolkata';

/** GET /api/dashboard - stats and chart data for Admin & Auctioneer dashboards. */
exports.summary = asyncHandler(async (req, res) => {
  const [statusCounts, teams, registrationsByDay, styleCounts] = await Promise.all([
    Player.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          paid: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, 1, 0] } },
          sold: { $sum: { $cond: [{ $eq: ['$soldStatus', 'Sold'] }, 1, 0] } },
          soldAmount: { $sum: { $ifNull: ['$soldAmount', 0] } },
        },
      },
    ]),
    Team.find().sort({ name: 1 }).lean(),
    Player.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$registrationDate', timezone: TIMEZONE } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Player.aggregate([
      { $match: { paymentStatus: 'Paid' } },
      {
        $group: {
          _id: '$cricketStyle',
          total: { $sum: 1 },
          sold: { $sum: { $cond: [{ $eq: ['$soldStatus', 'Sold'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const teamPlayerCounts = await Player.aggregate([
    { $match: { soldStatus: 'Sold' } },
    { $group: { _id: '$team', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(teamPlayerCounts.map((t) => [String(t._id), t.count]));

  const s = statusCounts[0] || { total: 0, paid: 0, sold: 0, soldAmount: 0 };
  const unpaid = s.total - s.paid;
  const unsold = s.paid - s.sold; // paid but not yet sold

  res.json({
    success: true,
    data: {
      cards: {
        totalRegistered: s.total,
        paid: s.paid,
        unpaid,
        totalTeams: teams.length,
        sold: s.sold,
        unsold,
        totalSoldAmount: s.soldAmount,
      },
      registrationsByDay: registrationsByDay.map((r) => ({ date: r._id, count: r.count })),
      paidVsUnpaid: [
        { name: 'Paid', value: s.paid },
        { name: 'Unpaid', value: unpaid },
      ],
      soldVsUnsold: [
        { name: 'Sold', value: s.sold },
        { name: 'Unsold', value: unsold },
      ],
      teamDistribution: teams.map((t) => ({ team: t.name, players: countMap[String(t._id)] || 0 })),
      purseUtilization: teams.map((t) => ({
        team: t.name,
        spent: t.totalPurse - t.remainingPurse,
        remaining: t.remainingPurse,
        total: t.totalPurse,
      })),
      styleBreakdown: styleCounts.map((c) => ({ style: c._id, total: c.total, sold: c.sold })),
      auctionProgress: {
        sold: s.sold,
        totalPaid: s.paid,
        percent: s.paid ? Math.round((s.sold / s.paid) * 100) : 0,
      },
      generatedAt: new Date(),
    },
  });
});
