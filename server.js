const http = require('http');
const WebSocket = require('ws');
const queue = require('async/queue');
const uuidV1 = require('uuid/v1');
const uuidV4 = require('uuid/v4');

class HARDWARE {
    constructor(pc) {
        this.pc = pc;
    }
}

class CPU extends HARDWARE {
    constructor(pc, cores, hyperThreading, speed) {
        super(pc);

        this.workers = cores;
        if (hyperThreading) this.workers *= 2;

        this.cycleDelay = 1000/speed;

        this.q = queue(this.cycle(), this.workers);
    }

    cycle() {
        const self = this;
        return (task, callback) => {
            setTimeout( () => {
                task.cycles--;
                if (task.cycles === 0) {
                    task.callback();
                } else {
                    let c = callback;
                    self.q.push(task);
                }
                callback();
            }, self.cycleDelay);
        }
    }

    addTask(appID, cycles, callback) {
        this.q.push({
            appID,
            cycles,
            callback
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
        for (let key in this.use_apps){
            total += this.use_apps[key];
        }
        return total
    }

    add(app_id, size) {
        if (this.use() + size <= this.size) {
            if (this.use_apps[app_id]) {
                this.use_apps[app_id] += size;
            } else {
                this.use_apps[app_id] = size;
            }
        } else {
            this.pc.os.runningApps[app_id].exit('Error: RAM is full, program exit.');
        }
    }
}

class OS {
    constructor(pc) {
        this.pc = pc;
        this.wss_server = http.createServer();
        this.wss = new WebSocket.Server({ server: this.wss_server });
        this.wss.on('connection', this.new_terminal());
        this.wss_server.listen(4578);

        this.pc.ram.add('system', 297321);

        this.runningApps = {};
    }

    new_terminal() {
        let self = this;
        return function(ws) {
            console.log('connect');

            let output = (output,) => {
                ws.send(JSON.stringify(output));
            };

            ws.on('message', (cmd_data) => {
                let data = JSON.parse(cmd_data);
                if (data[0] === 'cmd') {
                    if (data[1] === 0) {
                        pc.os.cmd(data[2], output);
                    } else {
                        this.runningApps[data[1]].res = data[2];
                    }
                }
            });
        }
    }

    cmd(cmd, output) {
        let args = cmd.split(" ");
        if (this.pc.softwares[args[0]]) {
            let software = this.pc.softwares[args[0]];
            let app = new software(this.pc, args, output);
            this.runningApps[app.index] = app;
            this.cmd_change_app(app.index, output);
            app.init();
            if (app.status) app.main();
        } else {
            this.cmd_not_found(cmd, args, output);
        }
    }

    cmd_change_app(index, output) {
        output(['set_app', index]);
    }

    cmd_not_found(cmd, args, output) {
        output(['echo',`Command ${args[0]} not found`]);
        output(['exit', 0]);
    }
}

class SOFTWARE {
    constructor(pc, args, output) {
        this.pc = pc;
        this.status = true;
        this.args = args;
        this.output = output;
        this.index = uuidV4();
        this.start_time = Date.now();
    }

    init() {

    }

    main() {
        this.exit();
    }

    echo(msg) {
        this.output(['echo', msg]);
    }

    exit(error) {
        this.status = false;
        this.output(['exit', error || 0]);
        delete this.pc.ram.use_apps[this.index];
        delete this.pc.os.runningApps[this.index];
    }

    ramAdd(size) {
        this.pc.ram.add(this.index, size);
    }

    addTask(cycles, callback) {
        this.pc.cpu.addTask(this.index, cycles, callback);
    }
}

class CMD_HI extends SOFTWARE {
    init() {
        this.ramAdd(1000);
    }

    main() {
        let self = this;
        this.echo('hello world');
        this.addTask(5, () => {
            self.echo('hello world after 5 cycles');
            self.exit();
        });
    }
}


class PC {
    constructor(softwares) {
        this.cpu = new CPU(this, 2, false, 3.4);
        this.ram = new RAM(this, 2000000);
        this.os = new OS(this);
        this.softwares = softwares || {
            hi: CMD_HI
        };
    }
}

let pc = new PC();

