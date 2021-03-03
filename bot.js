const sqlite3 = require('sqlite3').verbose();
const Discord = require('discord.js');


const require_admin = 2, require_moderator = 1, require_all = 0

class Bot {
    constructor(db, discord) {
        this.guild_settings = new Map();
        this.commands = new Map();

        this.follow_clients = new Map();
        this.get_latest_post = new Map();

        this.client = new Discord.Client();
        this.db = new sqlite3.Database(db, sqlite3.OPEN_READWRITE, (err)=> {
            if(err) {
                this.error(err);
            } else {
                this.info("Succes fully connected to the database");
                this.setup_database();
                this.setup_bots();
                this.setup_discord_client(discord);
            }
        });
        this.id_modifier = "id";
    }
    /* Database structure
    GUILD TABLE
    - guild_settings (Uses the guild id as TL key)
        - admin STRING (The id of the bot admin)
        - moderators STRING (A json string of user that get admin like privilegedes)
            - moderator_id STRING (The id of the moderator)
        - prefix STRING (The prefix for commands)
        - seperator STRING (The separator between command arguments)
        - room_id STRING (Room the bot is connected to when printing data)
        - update_interval INTEGER (The interval for updating twitter and reddit posts in ms)
        - following STRING (A json string of all the users the server is following)
            - client STRING (The client used to get the latest post)
            - username STRING (The username of the user)
            - alias STRING (The alias of the user)
            - last_post STRING (the last post of the user)
    */
    
    setup_database() {
        this.db.serialize(()=>{
            this.info("Setting up the database");
            this.db.run(`
                CREATE TABLE IF NOT EXISTS GUILDS (
                    GUILD_ID STRING NOT NULL UNIQUE,
                    ADMIN STRING NOT NULL,
                    MODERATORS STRING,
                    PREFIX STRING NOT NULL,
                    SEPERATOR STRING NOT NULL,
                    ROOM_ID STRING,
                    UPDATE_INTERVAL INTEGER,
                    FOLLOWING STRING
                );
            `);
        });
    }

    setup_bots(){
        this.get_all_guild_settings((guild)=>{
            this.guild_settings.set(guild["GUILD_ID"], {
                "admin": guild["ADMIN"].substr(2),
                "moderators": JSON.parse(guild["MODERATORS"]),
                "prefix": guild["PREFIX"],
                "seperator": guild["SEPERATOR"],
                "room_id": guild["ROOM_ID"] === null ? guild["ROOM_ID"] : guild["ROOM_ID"].substr(2),
                "update_interval": guild["UPDATE_INTERVAL"],
                "following": JSON.parse(guild["FOLLOWING"]),
            });
            this.loop_getters(guild["GUILD_ID"], 6000);
            this.info(`Launched bot for ${guild["GUILD_ID"]}`);
        });
    }

    setup_discord_client(discord_client_string) {
        this.client.on('ready', () => {
            this.info(`Logged in as ${this.client.user.tag}! id ${this.client.user.id}`);
        });
        
        this.client.on('message', msg => {
            let guild_id = this.id_modifier + msg.channel.guild.id.toString();
            if(this.guild_settings.has(guild_id) && this.guild_settings.get(guild_id) !== undefined) {
                let prefix = this.guild_settings.get(guild_id).prefix;
                if(msg.content[0] === prefix){
                    this.execute_command(msg);
                }
            } else if(msg.content === '!add_server'){
                let guild_id = this.get_guild(msg).substr(2);
                let admin_id = msg.channel.guild.ownerID;
                this.add_server(guild_id, admin_id, "!", " ");
                msg.reply(`Sever was successfully added to the bots database! The admin is ${admin_id}`);
            }
        });
        // Is triggered when bot joins a 
        this.client.on("guildCreate", guild => {
            this.add_server(guild.id, guild.ownerID, "!", " ", (guild_id)=>{
                console.log(guild_id)
            });
            this.info("Joined a new guild: " + guild.name);
        });
        
        //removed from a server
        this.client.on("guildDelete", guild => {
            this.info("Left a guild: " + guild.name);
            //[TODO]add database stuff to remove a guild
        });

        this.client.login(discord_client_string);
    }

    add_follow_client(client_name, client, get_latest_post) {
        if(this.follow_clients.has(client_name)){
            this.error(`The follow client ${client_name} is already registered by the bot!`, true);
        } else {
            this.follow_clients.set(client_name, client);
            this.get_latest_post.set(client_name, get_latest_post);
        }
    }

    update_latest_post(guild_id, link, account, latest_post){
        let following = this.guild_settings.get(guild_id).following;
        for (let follower of following){
            if(follower.username == account.username){
                follower.last_post = latest_post;
                break;
            }
        }
        this.update_guild_setting(guild_id, "following", following, JSON.stringify(following), guild_id => {
            let message = account.custom_message;
            message = message = message.split('_').join(' ');
            message = message.replace('$alias', account.alias);
            message = message.replace('$post', `${link+latest_post}`);
            
            let room_id = this.guild_settings.get(guild_id).room_id;
            this.send_message_to_channel(room_id, message);
            this.info(`New post from ${account.alias} why the fuck are you here!`);
        });
    }

    // Database operations
    add_server(guild_id, admin_id, prefix, seperator, callback){
            let query = `
                INSERT INTO GUILDS (GUILD_ID, ADMIN, PREFIX, SEPERATOR) 
                VALUES('${this.id_modifier+guild_id}', '${this.id_modifier+admin_id}', '${prefix}', '${seperator}');
            `;
            this.db.run(query, (err) => {
                if (err) {
                    this.error(err.message);
                } else {
                    this.guild_settings.set(this.id_modifier+guild_id, {
                        "guild_id": this.id_modifier+guild_id,
                        "admin": this.id_modifier+admin_id,
                        "moderators": [],
                        "prefix": prefix,
                        "seperator": seperator,
                        "room_id": '',
                        "update_interval": 0,
                        "following": [],
                    });
                    if(callback instanceof Function){
                        callback(guild_id);
                    }
                }
            });
    }

    update_guild_setting(guild_id, field, value, value_string,callback) {
        let query = `
            UPDATE GUILDS SET ${field} = '${value_string}'
            WHERE GUILD_ID = '${guild_id}';
        `
        this.db.get(query, (err) => {
            if (err) {
                this.error(err.message);
            } else {
                if(field == "room_id"){
                    this.guild_settings.get(guild_id)[field] = value.substring(2);
                } else {
                    this.guild_settings.get(guild_id)[field] = value;
                }
                if(callback instanceof Function){
                    callback(guild_id);
                }
            }
        });
        
    }

    get_guild_setting(guild_id, field, callback) {
        let query = `
        SELECT ${field} as ${field} FROM GUILDS
        WHERE GUILD_ID = '${guild_id}';
        `
        this.db.get(query, (err, row) => {
            if (err) {
                this.error(err.message);
            }
            if(callback instanceof Function){
                callback(guild_id, row[field]);
            }
        });
    }

    get_guild_settings(guild_id, callback) {
        let query = `
        SELECT * FROM GUILDS
        WHERE GUILD_ID = '${guild_id}';
        `
        this.db.get(query, (err, row) => {
            if (err) {
                this.error(err.message);
            }
            if(callback instanceof Function){
                callback(guild_id, row);
            }
        });
    }

    get_all_guild_settings(callback) {
        let query = "SELECT * FROM GUILDS;"
        this.db.each(query, (err, row) => {
            if (err) {
                console.error(err.message);
            } else {
                if(callback instanceof Function){
                    callback(row);
                }
            }
        });
    }

    /*
    $alias replace with user alias
    $post replace with post link 
    account = {
        username: '',
        last_post: '',
        alias: '',
        message: ''
    }
    */

    // Data getter loop
    async loop_getters(guild_id, interval){
        let following = this.guild_settings.get(guild_id).following;
        let room_id = this.guild_settings.get(guild_id).room_id;
        let update_interval;
        if(interval){
            update_interval = interval;
        } else {
            update_interval = this.guild_settings.get(guild_id).update_interval || 60000;
        }
        setTimeout(async () => {
            if(following  !== undefined && room_id !== null){
                for(let follower of following){
                    let get_latest_post = this.get_latest_post.get(follower.client);
                    get_latest_post(guild_id, follower);
                }
            }
            this.loop_getters(guild_id);
        }, update_interval);
    }

    // Discord.js
    send_message_to_channel(room_id, message){
        let room = this.client.channels.cache.get(room_id);
        if(room){
            room.send(message);
        } else {
            this.error(`Was unable to get access to the room ${room_id}`);
        }
    }

    /* Command handlers
        0: all
        1: mods and admin
        2: admin
    */
    on_command(command, privilege_level, handler) {
        if(!this.commands.has(command)){
            this.commands.set(command, {"level": privilege_level, "handler": handler});
            if(this.commands.has(command)){
                this.info(`Registered the command: ${command}`);
            }
        } else this.error(`Command already registered: ${command}`);
    }

    get_command_args(msg, argument_count) {
        let guild_id = this.get_guild(msg);
        let args = msg.content.split(this.guild_settings.get(guild_id).seperator);

        if(args.length === argument_count+1 && args instanceof Array){
            if(args.length > 2){
                // We start from the second element in the list since the first is the command.
                args.shift();
                return args;
            }
            //In the case that we only got a single argument.
            return args[1];
        } else {
            args.shift();
            msg.reply(`This command requires ${argument_count} argument you supplied the arguments: [${args}]`);
            return null;
        }
    }

    get_command(msg) {
        let guild_id = this.get_guild(msg);
        let args = msg.content.split(this.guild_settings.get(guild_id).seperator);
        return args[0].substring(1);
    }
    
    execute_command(msg){
        let command_name = this.get_command(msg);
        if (this.commands.has(command_name)){
            let command = this.commands.get(command_name);
            if(command.level === require_all){
                command.handler(msg);
            } else if(command.level === require_moderator){
                if(this.is_admin(msg) || this.is_moderator(msg)){
                    command.handler(msg);
                } else {
                    msg.reply(`You need to be an administrator or moderator to execute ${command}!`)
                }
            } else if(command.level === require_admin){
                if(this.is_admin(msg)){
                    command.handler(msg);
                } else {
                    msg.reply(`You need to be an administrator to execute ${command_name}!`)
                }
            } else {
                msg.reply(`This command requires a unkown privilege level ${command.level}!`);
            }
        } else {
            let error = `The command ${command_name} is not registered.`;
            msg.reply(error);
            this.error(error);
        }
    }

    // Helper functions
    is_moderator(msg){
        for(moderator of this.guild_settings.get(this.get_guild(msg)).moderators){
            if(moderator === this.get_sender(msg)){
                return true;
            }
        }
        return false;
    }

    is_admin(msg){
        let sender = this.get_sender(msg);
        let admin = this.guild_settings.get(this.get_guild(msg)).admin;
        if(admin === sender){
            return true;
        } else return false;
    }

    get_sender(msg){
        return msg.author.id;
    }

    get_guild(msg) {
        return this.id_modifier + msg.channel.guild.id;
    }

    error(err, exit) {
        if(exit) {
            console.error(err);
        } else{
            console.log("[error]",err);
        }
    }

    info(msg) {
        console.log("[info]", msg);
    }
}

module.exports = {Bot, require_admin, require_moderator, require_all};