import SocketIO = require('socket.io');
import Express = require('express');
import http_server = require('http');
import path = require('path');
import Config from '../shared/config';
import Position from '../shared/positions';
import Tank from '../shared/tanks';
import Bullet from '../shared/bullet';

function get_random_position(): Position {
    let x = (Math.random() * 10000) % Config.space.width;
    let y = (Math.random() * 10000) % Config.space.height;
    return { x: x, y: y };
}

function get_random_direction(): number {
    return (Math.random() * 10000) % 360;
}

// covert angle to radian
function covert_degree(x: number): number {
    return x * Math.PI / 180;
}

function get_line_slope(d: number): number {
    return 1 / Math.tan(covert_degree(d));
}

function create_tank(id: string): Tank {
    let dire = get_random_direction();
    return {
        pos: get_random_position(),
        blood: 1.0,
        name: "<unnamed> " + id,
        can_safe_fire: true,
        tank_dire: dire,
        gun_dire: dire,
        radar_dire: dire,
        is_moving: false,
        id: id,
    };
}

function create_bullet(tank: Tank, level: number) {
    let this_bullet: Bullet = {
        pos: {
            x: tank.pos.x,
            y: tank.pos.y,
        },
        dire: tank.gun_dire,
        level: level,
        source: tank.id,
    };
    bullets.push(this_bullet);
}

function check_crash_bullet(bullet: Bullet) {
    for (let id in tanks) {
        if (bullet.source === id) { continue; }

        let this_tank = tanks[id];
        if (bullet.pos.x >= this_tank.pos.x - Config.tanks.size / 2
            && bullet.pos.x <= this_tank.pos.x + Config.tanks.size / 2
            && bullet.pos.y >= this_tank.pos.y - Config.tanks.size / 2
            && bullet.pos.y <= this_tank.pos.y + Config.tanks.size / 2) {
            this_tank.blood -= Config.bullet.damage[bullet.level];
            return true;
        }
    }

    return false;
}

function check_outof_space(pos: Position) {
    let half_tank_size = Config.tanks.size / 2;

    if (pos.x < half_tank_size
        || pos.y < half_tank_size
        || pos.x > Config.space.width - half_tank_size
        || pos.y > Config.space.height - half_tank_size) {
        return true;
    }
    return false;
}

function move_position(pos: Position, angle: number, distance: number) {
    pos.x += distance * Math.cos(covert_degree(angle));
    pos.y += distance * Math.sin(covert_degree(angle));
}

const app = Express();
const http = new http_server.Server(app);
const io = new SocketIO(http);
let bullets = new Array<Bullet>();
let tanks = new Object();
let socket_list = new Array<SocketIO.Socket>();

io.on('connection', (socket: SocketIO.Socket) => {
    console.log("One tank joined: " + socket.id);

    socket_list[socket.id] = socket;
    let this_tank = create_tank(socket.id);
    tanks[socket.id] = this_tank;

    socket.on('disconnect', () => {
        delete tanks[socket.id];
        console.log("One tank disconnected.");
    });

    socket.on('turn-tank', (target: number) => {
        let once_update: number = Config.tanks.turn_speed.tank / (1000 / Config.game.update);
        if (target - this_tank.tank_dire < 0) {
            once_update *= -1;
        }

        let iid = setInterval(() => {
            if (this_tank.tank_dire == target) {
                clearInterval(iid);
                return;
            }

            if (Math.abs(target - this_tank.tank_dire) < Math.abs(once_update)) {
                this_tank.tank_dire = target;
            } else {
                this_tank.tank_dire += once_update;
            }
        }, Config.game.update);
    });

    socket.on('turn-gun', (target: number) => {
        let once_update: number = Config.tanks.turn_speed.gun / (1000 / Config.game.update);
        if (target - this_tank.gun_dire < 0) {
            once_update *= -1;
        }

        let iid = setInterval(() => {
            if (this_tank.gun_dire == target) {
                clearInterval(iid);
                return;
            }

            if (Math.abs(target - this_tank.gun_dire) < Math.abs(once_update)) {
                this_tank.gun_dire = target;
            } else {
                this_tank.gun_dire += once_update;
            }
        }, Config.game.update);
    });

    socket.on('turn-radar', (target: number) => {
        let once_update: number = Config.tanks.turn_speed.radar / (1000 / Config.game.update);
        if (target - this_tank.radar_dire < 0) {
            once_update *= -1;
        }

        let iid = setInterval(() => {
            if (this_tank.radar_dire == target) {
                clearInterval(iid);
                return;
            }

            if (Math.abs(target - this_tank.radar_dire) < Math.abs(once_update)) {
                this_tank.radar_dire = target;
            } else {
                this_tank.radar_dire += once_update;
            }
        }, Config.game.update);
    });

    socket.on('fire', (level: number) => {
        if (!this_tank.can_safe_fire || typeof (level) !== "number" || level > 4 || level < 0) {
            this_tank.blood -= Config.tanks.fire_too_much_damage;
            return;
        }

        this_tank.can_safe_fire = false;
        setTimeout(() => { this_tank.can_safe_fire = true; }, Config.tanks.fire_speed[level]);
        create_bullet(this_tank, level);
    });

    socket.on('move', (state: boolean) => { this_tank.is_moving = state; });

    socket.on('set-name', (name: string) => { this_tank.name = name + "<" + socket.id + ">"; });
});


setInterval(() => {
    for (let id in bullets) {
        let this_bullet = bullets[id];

        const move_split_time = 5;
        for (let i = 1; i <= move_split_time) {
            move_position(this_bullet.pos, this_bullet.dire, Config.bullet.speed / move_split_time);
            if (check_crash_bullet(this_bullet) || check_outof_space(this_bullet.pos)) {
                bullets.splice(<number><any>id, 1);
                break;
            }
        }
    }

    for (let id in tanks) {
        let this_tank: Tank = tanks[id];
        if (this_tank.blood <= 0) {
            let this_socket: SocketIO.Socket = socket_list[this_tank.id];
            this_socket.disconnect();
            delete tanks[id];
            continue;
        }

        if (!this_tank.is_moving) {
            continue;
        }

        move_position(this_tank.pos, this_tank.tank_dire, Config.tanks.max_speed);

        if (check_outof_space(this_tank.pos)) {
            this_tank.blood -= Config.tanks.crash_damage;

            let half_tank_size = Config.tanks.size / 2;
            this_tank.pos.x = Math.min(Config.space.width - half_tank_size, this_tank.pos.x);
            this_tank.pos.y = Math.min(Config.space.width - half_tank_size, this_tank.pos.y);

            this_tank.pos.x = Math.max(half_tank_size, this_tank.pos.x);
            this_tank.pos.y = Math.max(half_tank_size, this_tank.pos.y);
        }
    }

    io.emit("update", { tanks: tanks, bullets: bullets });
}, Config.game.update);

app.use('/', Express.static(path.join(__dirname + '../../../../client/')));
http.listen(3000, () => { console.log("Server started on Port 3000."); });
