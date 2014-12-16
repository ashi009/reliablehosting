var async = require('async');
var ping = require('net-ping');
var Stats = require('fast-stats').Stats;

var kPingOptions = {
  networkProtocol: ping.NetworkProtocol.IPv4,
  packetSize: 16,
  retries: 0,
  sessionId: process.pid % 65535,
  timeout: 600,
  ttl: 128
};

var pSession;

function pingTest(ip, duration, callback) {
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
      return Date.now() - startTime < duration;
  }, function() {
    var rep = rtts.length + errs.length;
    callback(null, {
      rep: rtts.length + errs.length,
      err: errs.length / rep,
      rtt: rtts.amean(),
      rttMoe: rtts.moe(),
      errs: errs,
      rtts: rtts
    });
  });
}

module.exports = pingTest;
