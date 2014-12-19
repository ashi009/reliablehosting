var http = require('http');
var fs = require('fs');
var dns = require('dns');

var async = require('async');
var chalk = require('chalk');
var request = require('request');
var htmlParser = require('fast-html-parser');
var ProgressBar = require('progress');
var Stats = require('fast-stats').Stats;
var inquirer = require('inquirer');

var speedTest = require('./lib/speedtest');
var pingTest = require('./lib/pingtest');

var kConfig = JSON.parse(fs.readFileSync('config.json'));
var pCache = JSON.parse(fs.readFileSync('cache.json'));
var pJar = request.jar();

var format = require('util').format;

function cacheWrapper(jobs, names) {
  names.forEach(function(name) {
    var fn = jobs[name];
    if (Array.isArray(fn))
      fn = fn[fn.length - 1];
    function wrapper(callback, results) {
      if (pCache[name])
        return callback.apply(null, pCache[name]);
      fn(function(err) {
        if (!err) {
          pCache[name] = [].slice.call(arguments);
          fs.writeFileSync('cache.json', JSON.stringify(pCache));
        }
        callback.apply(null, arguments);
      }, results);
    }
    if (Array.isArray(jobs[name])) {
      var job = jobs[name];
      job[job.length - 1] = wrapper;
    } else {
      jobs[name] = wrapper;
    }
  });
}

function log() {
  process.stdout.write(format.apply(null, arguments));
}

var kJobs = {
  login: function(callback) {
    log('logging in... ');
    request.post('https://intranet.reliablehosting.com/services/intranet/login/', {
      jar: pJar,
      form: kConfig.credential
    }, function(err, res, body) {
      if (err)
        return callback(err);
      if (res.statusCode != 302)
        return callback(new Error('Failed to login'));
      log('%s\n', chalk.green('OK'));
      callback();
    });
  },
  accountHash: ['login', function(callback) {
    log('getting hash... ');
    request.get('https://intranet.reliablehosting.com/services/intranet/vpn_accounts/', {
      jar: pJar
    }, function(err, res, body) {
      if (err)
        return callback(err);
      var root = htmlParser.parse(body);
      var elAccounts = root.querySelectorAll('.account-panel');
      var accounts = [];
      var pattern = /change_server\/([0-9a-f]+)/;
      for (var i = 0; i < elAccounts.length; i++) {
        var elHeader = elAccounts[i].querySelector('.panel-heading').removeWhitespace();
        var elChangeServerBtn = elAccounts[i].querySelector('.btn-change-server');
        if (elChangeServerBtn) {
          accounts.push({
            name: format('%s (%s)', elHeader.childNodes[0].text, elHeader.childNodes[1].text),
            value: pattern.exec(elChangeServerBtn.attributes.href)[1]
          });
        }
      }
      if (accounts.length === 0)
        return callback(new Error('Something went wrong'));
      inquirer.prompt([{
        type: 'list',
        name: 'account',
        message: 'Chose account:',
        choices: accounts
      }], function(answers) {
        log('%s %s\n', chalk.green('OK'), answers.account);
        callback(null, answers.account);
      });
    });
  }],
  servers: ['accountHash', function(callback, results) {
    log('getting servers... ');
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
          location: tr.querySelector('td.cs_serv').removeWhitespace().childNodes[2].text,
          remain: tr.querySelector('td.cs_acc').text
        });
      });
      log('%s %d servers\n', chalk.green('OK'), servers.length);
      callback(null, servers);
    });
  }],
  resolve: ['servers', function(callback, results) {
    var servers = results.servers;
    var bar = new ProgressBar('resolving... :percent :current/:total :etas', {
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
    var bar = new ProgressBar('pinging... :percent :current/:total :etas', {
      total: servers.length
    });
    var repStats = new Stats();
    var errStats = new Stats();
    var rttStats = new Stats();
    async.each(servers, function(server, callback) {
      pingTest(server.ip, kConfig.pingDuration, function(err, pingResult) {
        bar.tick();
        if (!err) {
          server.ping = pingResult;
          repStats.push(pingResult.rep);
          errStats.push(pingResult.err);
          rttStats.push(pingResult.rtt);
        }
        callback();
      });
    }, function(){
      callback(null, {
        rep: unwrapStats(repStats),
        err: unwrapStats(errStats),
        rtt: unwrapStats(rttStats)
      });
    });
    function unwrapStats(stats) {
      var range = stats.range();
      stats.min = range[0];
      stats.max = range[1];
      stats.avg = stats.amean();
      stats.p5 = stats.percentile(5);
      stats.p10 = stats.percentile(10);
      stats.p90 = stats.percentile(90);
      stats.p95 = stats.percentile(95);
      return stats;
    }
  }],
  stats: ['servers', 'ping', function(callback, results) {
    var servers = results.servers;
    var ping = results.ping;
    var scoreStats = new Stats();
    servers.forEach(function(server) {
      var pingResult = server.ping;
      var errScore = evaluate(pingResult.err, ping.err, true);
      var repScore = evaluate(pingResult.rep, ping.rep);
      var rttScore = evaluate(pingResult.rtt, ping.rtt, true);
      server.score = errScore * 0.6 + repScore * 0.2 + rttScore * 0.2;
      scoreStats.push(server.score);
      server.stats = format('%s\t%s ⨉ %s',
          colorize((pingResult.err * 100).toFixed(2) + '%', errScore),
          colorize(pingResult.rtt.toFixed(1) + '±' +
              pingResult.rttMoe.toFixed(1) + 'ms', rttScore),
          colorize(pingResult.rep, repScore));
      log('%s\t%s\t%s\n',
          colorize(server.score.toFixed(1), server.score),
          server.id,
          server.stats);
    });
    callback(null, scoreStats);
    function evaluate(n, stats, smallerBetter) {
      if (smallerBetter) {
        if (n == stats.min)
          return 10;
        if (n <= stats.p5)
          return 8;
        if (n <= stats.p10)
          return 6;
        if (n >= stats.p95)
          return 0;
        if (n > stats.avg)
          return 4;
      } else {
        if (n == stats.max)
          return 10;
        if (n >= stats.p95)
          return 8;
        if (n >= stats.p90)
          return 6;
        if (n <= stats.p5)
          return 0;
        if (n < stats.avg)
          return 4;
      }
      return 5;
    }
    function colorize(s, score) {
      if (score == 10)
        return chalk.bold(chalk.green(s));
      if (score >= 8)
        return chalk.cyan(s);
      if (score >= 6)
        return chalk.blue(s);
      if (score <= 2)
        return chalk.red(s);
      if (score <= 4)
        return chalk.yellow(s);
      return s;
    }
  }],
  pick: ['servers', 'stats', function(callback, results) {
    var p95score = results.stats.percentile(95);
    var servers = results.servers.filter(function(server) {
      return server.score >= p95score;
    }).sort(function(lhs, rhs) {
      return rhs.score - lhs.score ||
          lhs.err - rhs.err ||
          lhs.rtt - rhs.rtt;
    });
    log('%s\t%s\t%s\t%s\n',
        'id',
        'location',
        'err',
        'rtt');
    servers.forEach(function(server) {
      log('%s\t%s\t%s\n', server.id, server.location, server.stats);
    });
    inquirer.prompt([{
      type: 'checkbox',
      name: 'servers',
      message: 'Chose servers to test:',
      choices: servers.map(function(server, i) {
        return {
          name: format('%s (%s)', server.id, server.ip),
          value: i
        };
      })
    }], function(answers) {
      callback(null, answers.servers.map(function(index) {
        return servers[index];
      }));
    });
  }],
  speed: ['servers', 'pick', function(callback, results) {
    var servers = results.pick;
    var bar = new ProgressBar('testing speed... :percent :current/:total :etas', {
      total: servers.length
    });
    async.eachSeries(servers, function(server, callback) {
      speedTest(server.domain, function(err, res) {
        bar.tick();
        server.speed = res;
        callback();
      });
    }, callback);
  }],
  summary: ['servers', 'speed', function(callback, results) {
    results.pick.forEach(function(server) {
      log('%s\t%s↓\n',
          server.id,
          (server.speed.download / 1024 / 1024 * 8).toFixed(1) + 'mbps');
    });
    callback();
  }]
};

cacheWrapper(kJobs, ['login', 'accountHash', 'servers']);

async.auto(kJobs, function(err, results) {
  if (err)
    log('%s\n', chalk.red('Error'),  err);
  log('all done.\n');
});
