const http = require('http');
const WebSocket = require('ws');
const queue = require('async/queue');
const uuidV1 = require('uuid/v1');
const uuidV4 = require('uuid/v4');

class HARDWARE {
  constructor(pc) {
    this._pc = pc;
  }
}

class CPU extends HARDWARE {
  constructor(pc, cores, hyperThreading, speed) {
    super(pc);

    this.workers = cores;
    if (hyperThreading) this.workers *= 2;

    this.cycleDelay = 1000 / speed;

    this.q = queue(this.cycle(), this.workers);
  }

  cycle() {
    const self = this;
    return (task, callback) => {
      setTimeout(() => {
        task.cycles--;
        if (typeof task.step === 'function') task.step(task);
        if (task.cycles === 0) {
          task.callback(task);
        } else {
          self.q.push(task);
        }
        callback();
      }, self.cycleDelay);
    };
  }

  addTask(appID, cycles, callback, step) {
    this.q.push({
      appID,
      cycles,
      callback,
      step
    });
  }
}

class RAM extends HARDWARE {
  constructor(pc, size) {
    super(pc);

    this.size = size || 1000000;
    this.use_apps = {};
  }

  use() {
    let total = 0;
    for (let key in this.use_apps) {
      total += this.use_apps[key];
    }
    return total;
  }

  add(app_id, size) {
    if (this.use() + size <= this.size) {
      if (this.use_apps[app_id]) {
        this.use_apps[app_id] += size;
      } else {
        this.use_apps[app_id] = size;
      }
    } else {
      this._pc.os.runningApps[app_id].exit('Error: RAM is full, program exit.');
    }
  }

  remove(app_id, size) {
    if (this.use_apps[app_id]) {
      this.use_apps[app_id] -= size;
    }
  }

  clear(app_id) {
    delete this.use_apps[app_id];
  }
}

class SOFTWARE {
  constructor(pc, args, output) {
    this._pc = pc;
    this._status = true;
    this.args = args;
    this._output = output;
    this._index = uuidV4();
    this._start_time = Date.now();
    this._version = '1.0';
  }

  base() {
    let self = this;
    this.findArg('--version', param => self.echoVersion());
    this.findArg('--help', param => self.echoHelp());
  }

  init() {}

  main() {
    this.exit();
  }

  findArg(arg, callback) {
    for (let arg_index in this.args) {
      let index = parseInt(arg_index);
      if (arg === this.args[index]) {
        if (
          typeof this.args[index + 1] !== 'undefined' &&
          !this.args[index + 1].startsWith('-')
        ) {
          callback(this.args[index + 1]);
        } else {
          callback(null);
        }
      }
    }
  }

  echoVersion() {
    this._output(['echo', this._version]);
    this.exit();
  }

  echoHelp() {
    this._output(['echo', '--version          Show Version']);
    this._output(['echo', '--help             Show Help']);
    this.exit();
  }

  echo(msg) {
    this._output(['echo', msg]);
  }

  exit(error) {
    this._status = false;
    this._output(['exit', error || 0]);
    this.ramClear();
    delete this._pc.os.runningApps[this._index];
  }

  ramAdd(size) {
    this._pc.ram.add(this._index, size);
  }

  ramRemove(size) {
    this._pc.ram.remove(this._index, size);
  }

  ramClear() {
    this._pc.ram.clear(this._index);
  }

  addTask(cycles, callback, step) {
    this._pc.cpu.addTask(this._index, cycles, callback, step);
  }
}

class CMD_HI extends SOFTWARE {
  init() {
    let self = this;
    this.ramAdd(1000);

    this.name = null;

    this.findArg('--name', param => (self.name = param));
  }

  main() {
    let self = this;
    if (this.name) {
      this.echo(`Hello ${this.name}`);
    } else {
      this.echo('Hello world');
    }
    this.addTask(
      5,
      task => {
        self.echo('End 5 cycles');
        this.exit();
      },
      task => {
        self.echo(`5 cycles task step remaining ${task.cycles}`);
      }
    );
    this.addTask(2, task => {
      self.echo('End 2 cycles');
    });
    this.addTask(4, task => {
      self.echo('End 4 cycles');
    });
    this.addTask(2, task => {
      self.echo('End 2 cycles');
    });
    this.addTask(4, task => {
      self.echo('End 4 cycles');
    });
  }

  echoHelp() {
    this._output(['echo', '--version          Show Version']);
    this._output(['echo', '--help             Show Help']);
    this._output(['echo', '--name             Hello {Name}']);
    this.exit();
  }
}

class OS {
  constructor(pc) {
    this._pc = pc;
    this.wss_server = http.createServer();
    this.wss = new WebSocket.Server({ server: this.wss_server });
    this.wss.on('connection', this.new_terminal());
    this.wss_server.listen(4578);

    this.softwares = {
      hi: CMD_HI
    };
    this.runningApps = {};

    this._pc.ram.add('system', 197321);
  }

  new_terminal() {
    let self = this;
    return function(ws) {
      console.log('connect');

      let output = output => {
        ws.send(JSON.stringify(output));
      };

      ws.on('message', cmd_data => {
        let data = JSON.parse(cmd_data);
        if (data[0] === 'cmd') {
          if (data[1] === 0) {
            self.cmd(data[2], output);
          } else {
          }
        }
      });
    };
  }

  cmd(cmd, output) {
    let args = cmd.split(' ');
    if (this.softwares[args[0]]) {
      let software = this.softwares[args[0]];
      let app = new software(this._pc, args, output);
      this.runningApps[app._index] = app;
      output(['set_app', app._index]);
      app.init();
      if (app._status) app.base();
      if (app._status) app.main();
    } else {
      output(['echo', `Command ${args[0]} not found`]);
      output(['exit', 0]);
    }
  }
}

class PC {
  constructor() {
    this.cpu = new CPU(this, 2, true, 2.6);
    this.ram = new RAM(this, 2000000);
    this.os = new OS(this);
  }
}

let pc = new PC();
