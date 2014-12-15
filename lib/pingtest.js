var async = require('async');
var ping = require('net-ping');
var Stats = require('fast-stats').Stats;

var kPingTime = 60 * 1000;
var kPingOptions = {
  networkProtocol: ping.NetworkProtocol.IPv4,
  packetSize: 16,
  retries: 0,
  sessionId: process.pid % 65535,
  timeout: 600,
  ttl: 128
};

var pSession;

function pingTest(ip, callback) {
  if (!pSession)
    pSession = ping.createSession(kPingOptions);
  var rtts = new Stats();
  var errs = [];
  var totalTime = 0;
  var startTime = Date.now();
  async.doWhilst(function(next) {
    pSession.pingHost(ip, function(err, target, sentTime, receivedTime) {
      if (err)
        errs.push(err);
      else
        rtts.push(receivedTime - sentTime);
      next();
    });
  }, function() {
      return Date.now() - startTime < kPingTime;
  }, function() {
    var times = rtts.length + errs.length;
    callback(null, {
      times: rtts.length + errs.length,
      err: errs.length / times,
      rtt: rtts.amean(),
      rttMoe: rtts.moe(),
      errs: errs,
      rtts: rtts
    });
  });
}

module.exports = pingTest;
