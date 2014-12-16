var urlUtil = require('url');
var http = require('http');
var async = require('async');

var kDownloadTestParams = [350, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000]
    .map(function(size) {
      return {
        payload: size * size * 2,
        size: size
      };
    });
var kUploadTestParams = [0.25, 0.5, 1, 2, 4, 8, 16, 32]
    .map(function(size) {
      return {
        payload: size * 1000 * 1000
      };
    });

var kUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:24.0) Gecko/20100101 Firefox/24.0';
var kTimeout = 10000;
var kConcurrent = 2;

function runSingleDownloadTest(server, param, callback) {
  var startTime, responseTime, completeTime;
  var req = http.request({
    method: 'GET',
    port: 80,
    hostname: server,
    path: '/speedtest/random' + param.size + 'x' + param.size + '.jpg',
    headers: {
      'User-Agent': kUserAgent
    }
  }, function(res) {
    var length = 0;
    responseTime = process.hrtime(startTime);
    completeTime = responseTime;
    res.on('data', function(chunk) {
      length += chunk.length;
      completeTime = process.hrtime(startTime);
    });
    res.on('end', function() {
      callback(null, {
        responseTime: responseTime[0] + responseTime[1] * 1e-9,
        completeTime: completeTime[0] + completeTime[1] * 1e-9,
        length: length
      });
    });
  });
  req.on('error', function(e) {
    callback(e);
  });
  req.end();
  startTime = process.hrtime();
  setTimeout(function() {
    req.abort();
  }, kTimeout);
}

function aggregateStats(stats) {
  var avgResponseTime  = 0;
  var avgSpeed = 0;
  for (var i = 0; i < stats.length; i++) {
    avgResponseTime += stats[i].responseTime;
    avgSpeed += stats[i].length / (stats[i].completeTime - stats[i].responseTime);
  }
  avgResponseTime /= stats.length;
  // avgSpeed /= stats.length;
  return {
    rt: avgResponseTime,
    download: avgSpeed
  };
}

function runParallelTest(fn, server, param, callback) {
  async.times(kConcurrent, function(n, callback) {
    fn(server, param, callback);
  }, function(err, stats) {
    if (!err)
      stats = aggregateStats(stats);
    callback(err, stats);
  });
}

function runProgressiveTest(fn, server, params, callback) {
  async.waterfall([
    function(callback) {
      runParallelTest(fn, server, params[0], callback);
    },
    function(result, callback) {
      var maxPayload = (kTimeout * 1e-3 - result.avgResponseTime) * result.avgSpeed / kConcurrent;
      var bestParam = params[0];
      for (var i = 1; i < params.length; i++) {
        if (Math.abs(bestParam.payload - maxPayload) / maxPayload >
            Math.abs(params[i].payload - maxPayload) / maxPayload)
          bestParam = params[i];
      }
      runParallelTest(fn, server, bestParam, callback);
    }
  ], callback);
}


function testDownloadSpeed(server, callback) {
  runProgressiveTest(runSingleDownloadTest, server, kDownloadTestParams, callback);
}

module.exports = testDownloadSpeed;

// function downloadSpeed(url,callback){

//   callback=once(callback);

//   var concurrent=2,maxTime=(maxTime||10000)/1000;

//   var emit, running=0, started=0, done=0, todo=urls.length, totalBytes=0;
//   if (this.emit) {
//     emit=this.emit.bind(this);
//   } else {this.emit=function(){}};

//   next();

//   var timeStart=process.hrtime();

//   function next(){
//     if (started>=todo) return; //all are started
//     if (running>=concurrent) return;
//     running++;
//     var
//       starting=started,
//       url=urls[starting];
//     started++;

//     getHttp(url,true,function(err,count){ //discard all data and return byte count
//       var diff=process.hrtime(timeStart), timePct,amtPct;
//       diff=diff[0] + diff[1]*1e-9; //seconds

//       running--;
//       totalBytes+=count;
//       done++;

//       timePct=diff/maxTime*100;
//       amtPct=done/todo*100;
//       amtPct=0; //time-only

//       if (diff>maxTime) {
//         done=todo;
//       }
//       if (done<=todo) emit('downloadprogress',Math.round(Math.min(Math.max(timePct,amtPct),100.0)*10)/10);
//       if (done>=todo) {
//         callback(null,totalBytes/diff); //bytes/sec
//       } else {
//         next();
//       }
//     });

//     next(); //Try another
//   }
// }

// function uploadSpeed(url,sizes,maxTime,callback){

//   callback=once(callback);

//   var concurrent=2,maxTime=(maxTime||10000)/1000;

//   var emit, running=0, started=0, done=0, todo=sizes.length, totalBytes=0;
//   if (this.emit) {
//     emit=this.emit.bind(this);
//   } else {this.emit=function(){}};

//   next();

//   var timeStart=process.hrtime();

//   function next(){
//     if (started>=todo) return; //all are started
//     if (running>=concurrent) return;
//     running++;
//     var
//       starting=started,
//       size=sizes[starting];
//     started++;
//     //started=(started+1) % todo; //Keep staing more until the time is up...

//     randomPutHttp(url,size,function(err,count){ //discard all data and return byte count
//       if (done>=todo) return;
//       if (err) {
//         count=0;
//       }
//       var diff=process.hrtime(timeStart), timePct,amtPct;
//       diff=diff[0] + diff[1]*1e-9; //seconds

//       running--;
//       totalBytes+=size;
//       done++;

//       timePct=diff/maxTime*100;
//       amtPct=done/todo*100;
//       //amtPct=0; //time-only

//       if (diff>maxTime) {
//         done=todo;
//       }
//       if (done<=todo) emit('uploadprogress',Math.round(Math.min(Math.max(timePct,amtPct),100.0)*10)/10);
//       if (done>=todo) {
//         callback(null,totalBytes/diff); //bytes/sec
//       } else {
//         next();
//       }
//     });

//     next(); //Try another
//   }
// }
// function startDownload(ix){
//   ix=ix||0;
//   if (ix>=speedInfo.bestServers.length || ix>=options.maxServers) return startUpload();
//   var
//     server = speedInfo.bestServers[ix],
//     svrurl = server.url,
//     sizes = [350, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000],
//     urls = [], n, i, size;

//   for (n=0;n<sizes.length;n++){
//     size=sizes[n];
//     for (i=0;i<4;i++){
//       urls.push(url.resolve(svrurl,'random'+size+'x'+size+'.jpg'));
//     }
//   }

//   self.emit('testserver',server);

//   downloadSpeed.call(self,urls,options.maxTime,function(err,speed){
//     self.emit('downloadprogress',100);
//     self.emit('downloadspeed',speed);

//     if (speedInfo.downloadSpeed) {
//       if (speed>speedInfo.downloadSpeed) {
//         speedInfo.downloadSpeed=speed;
//         speedInfo.bestServer=server;
//       }
//     } else {
//       speedInfo.downloadSpeed=speed;
//     }

//     startDownload(ix+1);
//   });

// }

// function startUpload(){

//   var
//     sizesizes = [Math.round(0.25 * 1000 * 1000), Math.round(0.5 * 1000 * 1000), Math.round(1 * 1000 * 1000), Math.round(2 * 1000 * 1000), Math.round(4 * 1000 * 1000), Math.round(8 * 1000 * 1000), Math.round(16 * 1000 * 1000), Math.round(32 * 1000 * 1000)],
//     sizesize,
//     sizes=[],n,i;
//   for(n=0;n<sizesizes.length;n++){
//     sizesize=sizesizes[n];
//     for (i=0;i<25;i++){
//       sizes.push(sizesize);
//     }
//   }
//   self.emit('testserver',speedInfo.bestServer);
//   uploadSpeed.call(self,speedInfo.bestServer.url,sizes,options.maxTime,function(err,speed){
//     self.emit('uploadprogress',100);
//     self.emit('uploadspeed',speed);

//     speedInfo.uploadSpeed=speed;


//     //emit results as nice, clean, object

//     /*
//     { url: 'http://208.54.87.70/speedtest/upload.jsp',
//       lat: '40.9419',
//       lon: '-74.2506',
//       name: 'Wayne, NJ',
//       country: 'United States',
//       cc: 'US',
//       sponsor: 'T-Mobile',
//       id: '1861',
//       host: '208.54.87.70:8080',
//       dist: 114.3911751633326,
//       bestPing: 37.36689500000001 }
//     */

//     function num(name){
//       speedInfo.config.client[name]=parseFloat(speedInfo.config.client[name]);
//     }

//     num('lat');
//     num('lon');
//     num('isprating');
//     num('rating');
//     num('ispdlavg');
//     num('ispulavg');

//     delete speedInfo.config.client.loggedin; //We're never logged in, so this is useless.

//     //Convert to bytes/s
//     speedInfo.config.client.ispdlavg=speedInfo.config.client.ispdlavg*1000/8;
//     speedInfo.config.client.ispulavg=speedInfo.config.client.ispulavg*1000/8;

//     var
//       best=speedInfo.bestServer,
//       data={
//         speeds:{
//           //Rounding, because these numbers look way more accurate than they are...
//           download:Math.round(speedInfo.downloadSpeed),
//           upload:Math.round(speedInfo.uploadSpeed),
//         },
//         client:speedInfo.config.client,
//         server:{
//           host:url.parse(best.url).host,
//           lat:+best.lat,
//           lon:+best.lon,
//           location:best.name,
//           country:best.country,
//           cc:best.cc,
//           sponsor:best.sponsor,
//           distance:Math.round(best.dist*100)/100,
//           distanceMi:Math.round(best.distMi*100)/100,
//           ping:Math.round(best.bestPing*10)/10,
//           id:best.id
//         }

//       }
//     self.emit('data',data);
//     postResults();
//   });
// }
