var http = require('http');
var fs = require('fs');
var dns = require('dns');

var async = require('async');
var chalk = require('chalk');
var request = require('request');
var htmlParser = require('fast-html-parser');
var ProgressBar = require('progress');
var Stats = require('fast-stats').Stats;

var speedTest = require('./lib/speedtest');
var pingTest = require('./lib/pingtest');

var kParallel = 100;

var pJar = request.jar();

async.auto({
  login: function(callback) {
    console.log('logging in');
    request.post('https://intranet.reliablehosting.com/services/intranet/login/', {
      jar: pJar,
      form: JSON.parse(fs.readFileSync(__dirname + '/.credential.json'))
    }, function(err, res, body) {
      if (err)
        return callback(err);
      if (res.statusCode != 302)
        return callback(new Error('Failed to login'));
      console.log('logged in');
      callback();
    });
  },
  accountHash: ['login', function(callback) {
    console.log('getting hash');
    request.get('https://intranet.reliablehosting.com/services/intranet/vpn_accounts/', {
      jar: pJar
    }, function(err, res, body) {
      if (err)
        return callback(err);
      var match = /change_server\/([0-9a-f]+)/.exec(body);
      if (!match)
        return callback(new Error('Something went wrong'));
      console.log('hash found %s', match[1]);
      callback(null, match[1]);
    });
  }],
  servers: ['accountHash', function(callback, results) {
    console.log('getting servers');
    var link = 'https://intranet.reliablehosting.com/services/intranet/change_server/servers_table/' + results.accountHash + '/available/?country=&city=&network=&server_type=';
    request.get(link, {
      jar: pJar
    }, function(err, res, body) {
      if (err)
        return callback(err);
      var root = htmlParser.parse(body);
      var trs = root.querySelectorAll('tr');
      var servers = [];
      trs.forEach(function(tr) {
        if (!tr.id)
          return;
        servers.push({
          id: tr.id.substr(4),
          domain: tr.id + '.reliablehosting.com',
          location: tr.querySelector('td.cs_serv b').text,
          remain: tr.querySelector('td.cs_acc').text
        });
      });
      console.log('%d servers available', servers.length);
      callback(null, servers);
    });
  }],
  resolve: ['servers', function(callback, results) {
    var servers = results.servers;
    var bar = new ProgressBar('resolving percent :current/:total :etas', {
      total: servers.length
    });
    async.each(servers, function(server, callback) {
      async.retry(2, function(callback) {
        dns.resolve4(server.domain, callback);
      }, function(err, ips) {
        if (!err)
          server.ip = ips[0];
        bar.tick();
        callback();
      });
    }, callback);
  }],
  ping: ['servers', 'resolve', function(callback, results) {
    var servers = results.servers;
    var bar = new ProgressBar('pinging percent :current/:total :etas', {
      total: servers.length
    });
    var timesStats = new Stats();
    var errStats = new Stats();
    var rttStats = new Stats();
    async.each(servers, function(server, callback) {
      pingTest(server.ip, function(err, pingResult) {
        bar.tick();
        if (!err) {
          server.ping = pingResult;
          timesStats.push(pingResult.times);
          errStats.push(pingResult.err);
          rttStats.push(pingResult.rtt);
        }
        callback();
      });
    }, function(){
      callback(null, {
        times: unwrapStats(timesStats),
        err: unwrapStats(errStats),
        rtt: unwrapStats(rttStats)
      });
    });
    function unwrapStats(stats) {
      var range = stats.range();
      return {
        min: range[0],
        max: range[1],
        avg: stats.amean(),
        p5: stats.percentile(5),
        p10: stats.percentile(10),
        p90: stats.percentile(90),
        p95: stats.percentile(95)
      };
    }
  }],
  stat: ['servers', 'ping', function(callback, results) {
    var servers = results.servers;
    var ping = results.ping;
    console.log(ping);
    console.log('%s\t%s\t%s\t%s\t%s',
        'id',
        'avail',
        'pings',
        'err',
        'rtt');
    servers.forEach(function(server) {
      var pingResult = server.ping;
      console.log('%s\t%s\t%s\t%s\t%s',
          server.id,
          server.remain,
          colorize(pingResult.times, null, ping.times),
          colorize(pingResult.err, (pingResult.err * 100).toFixed(2) + '%', ping.err, true),
          colorize(pingResult.rtt, pingResult.rtt.toFixed(1) + '±' +
              pingResult.rttMoe.toFixed(1), ping.rtt, true));
    });
    callback();
    function colorize(n, s, stats, smallerBetter) {
      s = s || n;
      if (smallerBetter) {
        if (n == stats.min)
          return chalk.bold(chalk.green(s));
        if (n <= stats.p5)
          return chalk.cyan(s);
        if (n <= stats.p10)
          return chalk.blue(s);
        if (n >= stats.p95)
          return chalk.red(s);
        if (n > stats.avg)
          return chalk.yellow(s);
      } else {
        if (n == stats.max)
          return chalk.bold(chalk.green(s));
        if (n >= stats.p95)
          return chalk.cyan(s);
        if (n >= stats.p90)
          return chalk.blue(s);
        if (n <= stats.p5)
          return chalk.red(s);
        if (n < stats.avg)
          return chalk.yellow(s);
      }
      return s;
    }
  }]
}, function(err, results) {
  console.log(err);
  console.log(results.servers);
});
