const Bot = require('./bot.js');
const Reddit = require('reddit');
const Twitter = require('twitter');
const fs = require('fs');

let config = fs.readFileSync("./config.json");
config = JSON.parse(config.toString());

const bot = new Bot.Bot("./bot.db", config.discord);


bot.add_follow_client("Twitter", new Twitter(config.twitter), async (guild_id, account) => {  
    var params = {screen_name: account.username, count: 1};
    let client = bot.follow_clients.get(account.client);
    client.get('statuses/user_timeline', params, (error, tweets) =>{
        if (!error) {
            let latest_post = tweets[0].id_str;
            if (latest_post !== account.last_post){
                let link = `https://twitter.com/${account.username}/status/`;
                bot.update_latest_post(guild_id, link, account, latest_post);
            } else {
                bot.info(`no new posts from ${account.alias}`)
            }
        } else {
            bot.error(error.message);
        }
    });
});

bot.add_follow_client("Reddit", new Reddit(config.reddit), async (guild_id, account) => {
    let client = bot.follow_clients.get(account.client);
    const res = await client.get(`/user/${account.username}/submitted`, {});
    let latest_post = res.data.children[0].data.permalink;
    if (latest_post !== account.last_post){
        let link = "https://reddit.com";
        bot.update_latest_post(guild_id, link, account, latest_post);
    } else {
        bot.info(`no new posts from ${account.alias}`)
    }
});


// Parameters: UserID
bot.on_command("handover_admin", Bot.require_admin, msg => {
    let args = bot.get_command_args(msg, 1);
    let guild_id = bot.get_guild(msg)
    if(args !== null){
        if(bot.is_admin(msg)){
            bot.update_guild_setting(guild_id, "admin", admin_id, admin_id);
        }
    }
});

// Parameters: UserID
bot.on_command("add_moderator", Bot.require_admin, msg => {
    let args = bot.get_command_args(msg, 1);
    let guild_id = bot.get_guild(msg)
    if(args !== null){
        let moderator = args;
        if(bot.is_admin(msg)){
            let mods = bot.guild_settings.get(guild_id).moderators;
            mods.push(moderator);
            bot.update_guild_setting(guild_id, "moderators", mods, JSON.stringify(mods));
        }
    }
});

// Parameters: RoomID
bot.on_command("join_room", Bot.require_admin, msg => {
    let args = bot.get_command_args(msg, 1);
    let guild_id = bot.get_guild(msg);
    if(args !== null){
        let room_id = bot.id_modifier+args;
        if(bot.is_admin(msg) || bot.is_moderator(msg)){
            bot.update_guild_setting(guild_id, "room_id", room_id, room_id, ()=>{
                bot.send_message_to_channel(room_id.substring(2),`This is now the place for twitter and reddit updates!`);
            });
        }
    }
});

// Parameters: Interval
bot.on_command("set_update_interval", Bot.require_admin, msg => {
    let args = bot.get_command_args(msg, 1);
    let guild_id = bot.get_guild(msg);
    if(args !== null){
        let update_interval = args;
        if(bot.is_admin(msg)){
            bot.update_guild_setting(guild_id, "update_interval", update_interval, update_interval, ()=>{
                msg.reply(`The update interval is now ${update_interval}`);
            });
        }
    }
});

// Parameters: Client, Username, Alias, Custom message
bot.on_command("follow", Bot.require_moderator, msg => {
    let args = bot.get_command_args(msg, 4);
    let guild_id = bot.get_guild(msg);
    if(args !== null){
        let [client, username, alias, custom_message] = args;
        if(bot.follow_clients.has(client)){
            let following = bot.guild_settings.get(guild_id).following;
            if(following instanceof Array){
                for(user of following){
                    if(user.client === client && user.username === username){
                        user.alias = alias;
                        user.custom_message = custom_message;
                        bot.update_guild_setting(guild_id, "following", following, JSON.stringify(following), guild_id =>{
                            msg.reply(`Server updated alias and custom_message of ${username}`);
                        });
                        return;
                    }
                }
            }
            following.push({
                "client": client,
                "username": username,
                "alias": alias,
                "custom_message": custom_message,
                "last_post": ""
            });

            bot.update_guild_setting(guild_id, "following", following, JSON.stringify(following), guild_id =>{
                msg.reply(`Server is now following ${alias}(${username})`);
            });
        } else {
            msg.reply(`Server does not support the "${client}"!`);
        }
    }
});

// Parameters: Client, Username
bot.on_command("unfollow", Bot.require_moderator, msg => {
    let args = bot.get_command_args(msg, 2);
    let guild_id = bot.get_guild(msg);
    if(args !== null){
        let [client, username] = args;
        let following = bot.guild_settings.get(guild_id).following;
        for(user in following){
            if(following[user].client === client && following[user].username === username){
                let alias = following[user].alias;
                following.splice(user, 1);
                bot.update_guild_setting(guild_id, "following", following, JSON.stringify(following), guild_id =>{
                    msg.reply(`Server is no longer following ${alias}(${username})!`);
                });
            }
        }
    } else {
        bot.error(`Error parsing arguments`);
    }
});

// Parameters: None
bot.on_command("ping", Bot.require_all, msg => {
    msg.reply("pong");
});