const WebSocket = require('ws');
const readline = require('readline');

let rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ws = new WebSocket('ws://localhost:4578');

let current_app = 0;

let runCommand = input => {
  let ptint = input || ' > ';
  rl.question(ptint, cmd => {
    ws.send(JSON.stringify(['cmd', current_app, cmd]));
  });
};

ws.on('open', () => {
  runCommand();
});

ws.on('message', args_string => {
  let args = JSON.parse(args_string);
  let cmd = args[0];
  if (cmd === 'echo') {
    console.log(args[1]);
  } else if (cmd === 'exit') {
    if (args[1] === 0) {
      current_app = 0;
      runCommand();
    } else {
      current_app = 0;
      console.log(args[1]);
      runCommand();
    }
  } else if (cmd === 'set_app') {
    current_app = args[1];
  }
});
