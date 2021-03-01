const sqlite3 = require('sqlite3').verbose();
const Discord = require('discord.js');
const Reddit = require('reddit');
const Twitter = require('twitter');
const fs = require('fs');

class Bot {
    constructor(db, discord, reddit, twitter) {
        this.guild_settings = new Map();
        this.commands = new Map();
        this.client = new Discord.Client();
        this.reddit = new Reddit(reddit);
        this.twitter = new Twitter(twitter);
        this.db = new sqlite3.Database(db, sqlite3.OPEN_READWRITE, (err)=> {
            if(err) {
                this.error(err);
            } else {
                this.info("Succes fully connected to the database");
                this.setup_database();
                this.setup_bots();
                this.setup_discord_client(discord);
                this.setup_commands();
            }
        });
        /*
            js implicity type conversion rant.
            So here i was thinking i made some big mistake.
            The ids would allways be wrong by a couple of digits.
            But why you might ask is this not just some stupid mistake you made?
            But the answer is sadly no, javascript in all it's winsdom saw that my string
            consisted of only numbers and said this is not a string no more this is a number.
            Thats when it all started going down hill because javascript in all it's winsdom
            forgot how to convert a string to a number and made a mistake in last digits every time.
            So i was forced to add a modifier to the text to help javascript under stand that this was no number.
        */
        this.id_modifier = "id";
        /*
            Get all the guild settings in an array so we don't have to query the database
            every time we want to get the prefix and so on.
            STRUCTURE
            {GUILD_ID: {
                admin: '',
                moderators: ['id',...],
                prefix: '',
                sepereator: '',
                room_id: '',
                update_interval: ''.
                follow_reddit: [{
                    username: '',
                    last_post: '',
                    alias: '',
                    message: ''
                },...],
                follow_twitter: [{
                    username: '',
                    last_post: '',
                    alias: '',
                    message: ''
                },...]
                
            },...}
        */
    }
    // Setup handlers
    /*
    Database structure
    - guild_settings (Uses the guild id as TL key)
        - admin STRING (The id of the bot admin)
        - moderators STRING (A json string of user that get admin like privilegdes)
            - moderator_id STRING (The id of the moderator)
        - prefix STRING (The prefix for commands)
        - seperator STRING (The separator between command arguments)
        - room_id STRING (Room the bot is connected to when printing data)
        - update_interval INTEGER (The interval for updating twitter and reddit posts in ms)
        - follow_reddit OBJECT (A json string of all users to follow on reddit)
            - username STRING (the username)
            - alias STRING (The users alias)
            - message STRING (Custom message for when a new post is posted)
            - last_post path STRING (The path to the last post)
        - follow_twitter OBJECT (A json string of all users to follow on twitter)
             - username STRING (the username)    
             - alias STRING (The users alias)
             - message STRING (Custom message for when a new post is posted)
             - last_tweet STRING (The path to the last tweet)
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
                    FOLLOW_REDDIT STRING,
                    FOLLOW_TWITTER STRING
                );
            `);
        });
    }

    setup_bots(){
        this.get_all_guild_settings((guild)=>{
            this.guild_settings.set(guild["GUILD_ID"], {
                "admin": guild["ADMIN"],
                "moderators": JSON.parse(guild["MODERATORS"]),
                "prefix": guild["PREFIX"],
                "seperator": guild["SEPERATOR"],
                "room_id": guild["ROOM_ID"] === null ? guild["ROOM_ID"] : guild["ROOM_ID"].substr(2),
                "update_interval": guild["UPDATE_INTERVAL"],
                "follow_reddit": JSON.parse(guild["FOLLOW_REDDIT"]),
                "follow_twitter": JSON.parse(guild["FOLLOW_TWITTER"])
            });
            this.loop_getters(guild["GUILD_ID"]);
            this.info(`Launched bot for ${guild["GUILD_ID"]}`);
        });
    }

    setup_commands(){
        this.on_command("handover_admin", msg => {
            let args = this.get_command_args(msg);
            let guild_id = this.get_guild_from_message(msg)
            if(args instanceof Array){
                msg.reply(`This command only requires 1 argument you supplied the arguments: ${args}`);
            } else {
                let admin_id = args;
                if(admin_id === this.guild_settings.get(guild_id).admin){
                    this.update_guild_setting(guild_id, "admin", admin_id);
                }
            }
        });

        this.on_command("add_moderator", msg => {
            let args = this.get_command_args(msg);
            let guild_id = this.get_guild_from_message(msg)
            if(args instanceof Array){
                msg.reply(`This command only requires 1 argument you supplied the arguments: ${args}`);
            } else {
                let moderator = args;
                let admin_id = this.get_admin(guild_id);
                if(admin_id === this.guild_settings.get(guild_id).admin){
                    let mods = this.guild_settings.get(guild_id).moderators;
                    mods.push(moderator);
                    this.update_guild_setting(guild_id, "moderators", mods);
                }
            }
        });

        this.on_command("join_room", msg => {
            let args = this.get_command_args(msg);
            let guild_id = this.get_guild_from_message(msg);
            if(args instanceof Array){
                msg.reply(`This command only requires 1 argument you supplied the arguments: ${args}`);
            } else {
                let room_id = this.id_modifier+args;
                // add so mods can do it too
                let admin_id = this.get_admin(guild_id);
                if(admin_id === this.guild_settings.get(guild_id).admin){
                    this.update_guild_setting(guild_id, "room_id", room_id, ()=>{
                        this.send_message_to_channel(room_id.substring(2),`This is now the place for twitter and reddit updates!`);
                    });
                }
            }
        });

        this.on_command("set_update_interval", msg => {
            let args = this.get_command_args(msg);
            let guild_id = this.get_guild_from_message(msg);
            if(args instanceof Array){
                msg.reply(`This command only requires 1 argument you supplied the arguments: ${args}`);
            } else {
                let update_interval = args;
                // [TODO] ARE YOU FUCKING DRUNK CHECKING THE STORED ID VS THE STORED ID!!!
                let admin_id = this.get_admin(guild_id);
                if(admin_id === this.guild_settings.get(guild_id).admin){
                    this.update_guild_setting(guild_id, "update_interval", update_interval, ()=>{
                        msg.reply(`The update interval is now ${update_interval}`);
                    });
                }
            }
        });

        this.on_command("follow_reddit_account", msg => {
            let args = this.get_command_args(msg);
            let guild_id = this.get_guild_from_message(msg);
            if(args instanceof Array && args.length === 3){
                let follow_object = `{"username":"${args[0]}","alias":"${args[1]}","message":"${args[2]}","last_post":""}`;
                let admin_id = this.get_admin(guild_id);
                if(admin_id === this.guild_settings.get(guild_id).admin){
                    if (this.guild_settings.get(guild_id).follow_reddit == null){
                        this.update_guild_setting(guild_id, "follow_reddit", "["+follow_object+ "]", (guild_id)=>{
                            this.refresh_guild_settings(guild_id);
                        });
                    } else {
                        let follow_reddit = this.guild_settings.get(guild_id).follow_reddit;
                        for(let user of follow_reddit){
                            if(args[0] === user.username){
                                msg.reply(`This server is allready following "${args[0]}"`);
                                return;
                            } 
                        }
                        msg.reply(`This server is now following "${args[0]}"`);
                        this.guild_settings.get(guild_id).follow_reddit.push(JSON.parse(follow_object));
                        this.update_guild_setting(guild_id, "follow_reddit", JSON.stringify(follow_reddit));
                    }
                }
            } else {
                msg.reply(`This command requires 3 argument you supplied the arguments: ${args}`);
            }
        });

        this.on_command("unfollow_reddit_account", msg => {
            let args = this.get_command_args(msg);
            let guild_id = this.get_guild_from_message(msg);
            if(args instanceof String){
                let admin_id = this.get_admin(guild_id);
                if(admin_id === this.guild_settings.get(guild_id).admin){
                    let follow_reddit = this.guild_settings.get(guild_id).follow_reddit;
                        for(let user of follow_reddit){
                            if(args[0] === user.username){
                                //[TODO] Remove from data base and local settings
                                return;
                            } 
                        }
                }
            }
        });

        this.on_command("follow_twitter_account", msg => {
            let args = this.get_command_args(msg);
            let guild_id = this.get_guild_from_message(msg);
            if(args instanceof Array && args.length === 3){
                let follow_object = `{"username":"${args[0]}","alias":"${args[1]}","message":"${args[2]}","last_tweet":""}`;
                let admin_id = this.get_admin(guild_id);
                if(admin_id === this.guild_settings.get(guild_id).admin){
                    if (this.guild_settings.get(guild_id).follow_twitter == null){
                        this.update_guild_setting(guild_id, "follow_twitter", "["+follow_object+ "]", (guild_id)=>{
                            this.refresh_guild_settings(guild_id);
                        });
                    } else {
                        let follow_twitter = this.guild_settings.get(guild_id).follow_twitter;
                        for(let user of follow_twitter){
                            if(args[0] === user.username){
                                msg.reply(`This server is allready following "${args[0]}"`);
                                return;
                            } 
                        }
                        msg.reply(`This server is now following "${args[0]}"`);
                        this.guild_settings.get(guild_id).follow_twitter.push(JSON.parse(follow_object));
                        this.update_guild_setting(guild_id, "follow_twitter", JSON.stringify(follow_twitter));
                    }
                }
            } else {
                msg.reply(`This command requires 3 argument you supplied the arguments: ${args}`);
            }
        });

        this.on_command("unfollow_twitter_account", msg => {
            // [TODO] create a function
        });

        this.on_command("get_settings", msg => {
            this.get_guild_settings(this.get_guild_from_message(msg), (guild_id, settings) => {
                console.log(settings);
                msg.reply(JSON.stringify(settings));
            })
        });
    }

    setup_discord_client(discord_client_string) {
        this.client.on('ready', () => {
            this.info(`Logged in as ${this.client.user.tag}! id ${this.client.user.id}`);
        });
        
        this.client.on('message', msg => {
            let guild_id = this.id_modifier + msg.channel.guild.id.toString();
            if (msg.content === 'ping') {
                msg.reply('Pong!');
            }
            if(this.guild_settings.has(guild_id) && this.guild_settings.get(guild_id) !== undefined) {
                let prefix = this.guild_settings.get(guild_id).prefix;
                if(msg.content[0] === prefix){
                    this.execute_command(msg);
                }
            } else if(msg.content === '!add_server'){
                let guild_id = this.get_guild_from_message(msg).substr(2);
                let admin_id = this.get_admin_from_message(msg).substr(2);
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
                        "follow_reddit": [],
                        "follow_twitter": []
                    });
                    if(callback instanceof Function){
                        callback(guild_id);
                    }
                }
            });
    }

    update_guild_setting(guild_id, field, value, callback) {
        let query = `
            UPDATE GUILDS SET ${field} = '${value}'
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

    refresh_guild_settings(guild_id, callback) {
        this.get_guild_settings(guild_id, (guild_id, settings)=>{
            this.info(`Refreshing ${guild_id}'s settings`)
            this.guild_settings.set(settings["GUILD_ID"], {
                "admin": settings["ADMIN"],
                "moderators": settings["MODERATORS"] === undefined ? settings["MODERATORS"] : "",
                "prefix": settings["PREFIX"],
                "seperator": settings["SEPERATOR"],
                "room_id": settings["ROOM_ID"].substring(2),
                "update_interval": settings["UPDATE_INTERVAL"],
                "follow_reddit": JSON.parse(settings["FOLLOW_REDDIT"]),
                "follow_twitter": JSON.parse(settings["FOLLOW_TWITTER"])
            });
            if(callback instanceof Function){
                callback(guild_id);
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
    // External data getters
    async get_latest_tweet(guild_id, account){
        var params = {screen_name: account.username, count: 1};
        this.twitter.get('statuses/user_timeline', params, (error, tweets) =>{
            if (!error) {
                let latest_tweet = tweets[0].id_str;
                if(latest_tweet !== account.last_tweet){
                    let accounts = this.guild_settings.get(guild_id).follow_twitter;
                    for(let i in accounts){
                        if(accounts[i].username == account.username){
                            accounts[i].last_tweet = latest_tweet;
                            break;
                        }
                    }
                    this.update_guild_setting(guild_id, "follow_twitter", JSON.stringify(accounts), (guild_id)=>{
                        let message = account.message;
                        message = message.split('_').join(' ');
                        message = message.replace('$alias', account.alias);
                        message = message.replace('$post', `${`https://twitter.com/${account.username}/status/${latest_tweet}`}`);
                        let room_id = this.guild_settings.get(guild_id).room_id;
                        this.send_message_to_channel(room_id, message);
                        this.info(`New post from ${account.alias} why the fuck are you here!`);
                        this.guild_settings.get(guild_id).follow_twitter = accounts;
                    });
                } else {
                    this.info(`No new posts from ${account.alias} :C`);
                }
            } else {
                this.error(error.message);
            }
        });
    }

    async get_latest_post(guild_id, account){
        const res = await this.reddit.get(`/user/${account.username}/submitted`, {});
        let latest_post = res.data.children[0].data.permalink;
        if (latest_post !== account.last_post){
            let accounts = this.guild_settings.get(guild_id).follow_reddit;
            for (let i in accounts){
                if(accounts[i].username == account.username){
                    accounts[i].last_post = latest_post;
                    break;
                }
            }
            this.update_guild_setting(guild_id, "follow_reddit", JSON.stringify(accounts), (guild_id)=>{
                let message = account.message;
                message = message = message.split('_').join(' ');
                message = message.replace('$alias', account.alias);
                message = message.replace('$post', `${"https://reddit.com/"+latest_post}`);
                let room_id = this.guild_settings.get(guild_id).room_id;
                this.send_message_to_channel(room_id, message);
                this.info(`New post from ${account.alias} why the fuck are you here!`);
                this.guild_settings.get(guild_id).follow_reddit = accounts;
            });
        } else {
            this.info(`No new posts from ${account.alias} :C`);
        }
    }

    // Data getter loop
    async loop_getters(guild_id){
        let reddit = this.guild_settings.get(guild_id).follow_reddit;
        let twitter = this.guild_settings.get(guild_id).follow_twitter;
        let room_id = this.guild_settings.get(guild_id).room_id;
        let update_interval = this.guild_settings.get(guild_id).update_interval || 60000;
        setTimeout(async () => {
            if(room_id  !== undefined && room_id !== null){
                if(reddit !== undefined && reddit !== null){
                    for(let account of reddit){
                        this.get_latest_post(guild_id, account);
                    }
                }
                if(twitter !== undefined && twitter !== null){
                    for(let account of twitter){
                        this.get_latest_tweet(guild_id, account);
                    }
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

    // Command handlers
    on_command(command, handler) {
        if(!this.commands.has(command)){
            this.commands.set(command, handler);
            if(this.commands.has(command)){
                this.info(`Registered the command: ${command}`);
            }
        }
    }

    get_command_args(msg) {
        let guild_id = this.get_guild_from_message(msg);
        let args = msg.content.split(this.guild_settings.get(guild_id).seperator)
        let arglen = args.length;
        if(arglen > 2){
            // We start from the second element in the list since the first is the command.
            args.shift();
            return args;
        }
        //In the case that we only got a single argument.
        return  args[1]; 
    }

    get_command(msg) {
        let guild_id = this.get_guild_from_message(msg);
        let args = msg.content.split(this.guild_settings.get(guild_id).seperator);
        return args[0].substring(1);
    }
    
    get_admin(guild_id) {
        return this.guild_settings.get(guild_id).admin;
    }

    get_guild_from_message(msg) {
        return this.id_modifier + msg.channel.guild.id;
    }
    
    get_admin_from_message(msg) {
        return this.id_modifier + msg.channel.guild.ownerID;
    }

    execute_command(msg){
        let command = this.get_command(msg);
        if (this.commands.has(command)){
            // expand the list so instead of func([foo, barr]) we get func(foo, bar)
            this.commands.get(command)(msg);
        } else {
            let error = `The command ${command} is not registered.`;
            msg.reply(error);
            this.error(error);
        }
    }

    // Helper functions
    is_moderator(guild_id, moderator){
        for(mod of this.guild_settings.get(guild_id).moderators){
            if(mod === moderator){
                return true;
            }
        }
        return false;
    }

    error(err) {
        console.log("[error]",err);
    }
    info(msg) {
        console.log("[info]", msg);
    }
}
let config = fs.readFileSync("./config.json");
config = JSON.parse(config.toString());
bot = new Bot("./bot.db", config.discord, config.reddit, config.twitter);