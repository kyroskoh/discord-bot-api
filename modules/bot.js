// Discord Bot API
import configModule from './config';
import {plugins} from './plugins';
import api from './api';
import events from './events';

// Other
import DiscordClient from 'discord.io';
import chalk from 'chalk';
import packageJSON from '../package';
import fs from 'fs';
import request from 'request';

let bot = null; // The Discord instance will be stored in this object
let commandHistory = {};
let reconnectInterval = null;

// Handle incomming message
function handleMessage(user, userID, channelID, message, rawEvent) {
    // Only listen on the server defined by the config.json
    if (bot.serverFromChannel(channelID) !== configModule.get().serverID) {
        return false;
    }

    // Check if channel is ignored
    if (configModule.get().ignoreChannels) {
        for (let channelName of configModule.get().ignoreChannels) {
            channelName = channelName.replace('#', '');

            for (let id in bot.servers[configModule.get().serverID].channels) {
                if (bot.servers[configModule.get().serverID].channels.hasOwnProperty(id)) {
                    const channel = bot.servers[configModule.get().serverID].channels[id];

                    if (channel.type !== 'text') {
                        continue;
                    }

                    if (channel.name === channelName && channel.id === channelID) {
                        return false;
                    }
                }
            }
        }
    }

    // Check if a mention is required by the configModule.json
    if (configModule.get().mentionRequired) {
        // Check if the bot got mentioned
        if (message.indexOf('<@' + bot.id + '>') !== 0) {
            return false;
        }

        // Remove the mention from the message
        message = message.substring(('<@' + bot.id + '>').length);
        message = message.trim();
    }

    // Check if the global command prefix is on the first position of the message
    if (message.indexOf(configModule.get().globalCommandPrefix) !== 0) {
        return false;
    }

    // Remove the global command prefix from the message
    message = message.substring(configModule.get().globalCommandPrefix.length).trim();

    // There is no requested command
    if (message.length < 1) {
        return false;
    }

    // Check if the cooldown of the user is already expired
    if (configModule.get().commandCooldown && commandHistory[userID]) {
        const timeDifference = new Date().getTime() - commandHistory[userID].getTime();
        // The cooldown is not yet expired
        if (timeDifference < configModule.get().commandCooldown) {
            return false;
        }
    }
    commandHistory[userID] = new Date();

    // Split message by spaces
    message = message.split(' ');

    // Search for the command
    for (let key in plugins) {
        if (plugins.hasOwnProperty(key)) {
            let plugin = plugins[key];

            // Get the command prefix of the plugin
            let pluginCommandPrefix = configModule.get().plugins && configModule.get().plugins[plugin.name] && configModule.get().plugins[plugin.name].commandPrefix && configModule.get().plugins[plugin.name].commandPrefix.length > 0
                ? configModule.get().plugins[plugin.name].commandPrefix
                : plugin.defaultCommandPrefix;

            if (!pluginCommandPrefix || message[0] === pluginCommandPrefix) {
                if (pluginCommandPrefix) {
                    // Remove the prefix of the plugin from the message
                    message.shift();
                }

                for (let command in plugin.commands) {
                    if (plugin.commands.hasOwnProperty(command)) {
                        // Create a list with enabled synonyms for this command
                        let synonyms = [];

                        // Check plugins default synonyms
                        if (plugin.commands[command].synonyms) {
                            synonyms = plugin.commands[command].synonyms;
                        }

                        if (synonyms.indexOf(command) < 0) {
                            synonyms.unshift(command);
                        }

                        // Check config.json for synonyms
                        if (
                            configModule.get().plugins
                            && configModule.get().plugins[plugin.name]
                            && configModule.get().plugins[plugin.name].commands
                            && configModule.get().plugins[plugin.name].commands[command]
                            && configModule.get().plugins[plugin.name].commands[command].synonyms
                        ) {
                            for (let synonym in configModule.get().plugins[plugin.name].commands[command].synonyms) {
                                if (configModule.get().plugins[plugin.name].commands[command].synonyms.hasOwnProperty(synonym)) {
                                    if (configModule.get().plugins[plugin.name].commands[command].synonyms[synonym].enabled) {
                                        if (synonyms.indexOf(synonym) < 0) {
                                            synonyms.push(synonym);
                                        }
                                    } else if (configModule.get().plugins[plugin.name].commands[command].synonyms[synonym].enabled === false) {
                                        const index = synonyms.indexOf(synonym);
                                        if (index >= 0) {
                                            synonyms.splice(index, 1);
                                        }
                                    }
                                }
                            }
                        }

                        if (synonyms.indexOf(message[0]) >= 0) {
                            // Remove the requested command from the message
                            message.shift();

                            // Check the permissions of the command
                            let permissionRequiredByConfig = null;
                            if (
                                configModule.get().plugins
                                && configModule.get().plugins[plugin.name]
                                && configModule.get().plugins[plugin.name].commands
                                && configModule.get().plugins[plugin.name].commands[command]
                                && configModule.get().plugins[plugin.name].commands[command].requirePermission
                            ) {
                                permissionRequiredByConfig = true;
                            } else if (
                                configModule.get().plugins
                                && configModule.get().plugins[plugin.name]
                                && configModule.get().plugins[plugin.name].commands
                                && configModule.get().plugins[plugin.name].commands[command]
                                && configModule.get().plugins[plugin.name].commands[command].requirePermission === false
                            ) {
                                permissionRequiredByConfig = false;
                            }

                            if (permissionRequiredByConfig !== null) {
                                if (permissionRequiredByConfig && !api.isOperator(userID, plugin.name + ':' + command, channelID)) {
                                    return false;
                                }
                            } else if (plugin.commands[command].requirePermission && !api.isOperator(userID, plugin.name + ':' + command, channelID)) {
                                return false;
                            }

                            // Check the command requires an channel
                            if (
                                configModule.get().plugins
                                && configModule.get().plugins[plugin.name]
                                && configModule.get().plugins[plugin.name].commands
                                && configModule.get().plugins[plugin.name].commands[command]
                                && configModule.get().plugins[plugin.name].commands[command].channel
                            ) {
                                let requestChannel = configModule.get().plugins[plugin.name].commands[command].channel.replace('#', '');

                                for (let id in bot.servers[configModule.get().serverID].channels) {
                                    if (bot.servers[configModule.get().serverID].channels.hasOwnProperty(id)) {
                                        const channel = bot.servers[configModule.get().serverID].channels[id];

                                        if (channel.type !== 'text') {
                                            continue;
                                        }

                                        if (channel.name === requestChannel && channel.id !== channelID) {
                                            bot.sendMessage({
                                                to: channelID,
                                                message: 'You can request this command only here <#' + channel.id + '>',
                                            });
                                            return false;
                                        }
                                    }
                                }
                            }

                            //
                            message = message.join(' ');

                            // Execute the command
                            plugin.commands[command].fn(user, userID, channelID, message, rawEvent);
                            return true;
                        }
                    }
                }
            }
        }
    }

    return false;
}

function setAvatar(base64) {
    bot.editUserInfo({
        avatar: base64,
        password: configModule.get().credentials.password,
    });
}

// Start the discord instance
bot = new DiscordClient({
    email: configModule.get().credentials.email,
    password: configModule.get().credentials.password,
    autorun: true,
});

// Discord instance is ready
bot.on('ready', () => {
    console.log(chalk.green('Plugins'));
    for (const name in configModule.get().plugins) {
        if (configModule.get().plugins.hasOwnProperty(name)) {
            if (!plugins.hasOwnProperty(name)) {
                console.log(chalk.red(name + ' failed to load'));
                continue;
            }

            console.log(name + ' loaded');
        }
    }
    console.log(''); // Empty line

    console.log(chalk.green('Discord Bot API started.'));
    console.log('v' + packageJSON.version);
    console.log(''); // Empty line

    reconnectInterval = null;

    // Set the name of the bot to the one defined in the configModule.json
    if (configModule.get().credentials.name) {
        bot.editUserInfo({
            password: configModule.get().credentials.password,
            username: configModule.get().credentials.name,
        });
    }

    // Set the avatar of the bot to the one defined in the configModule.json
    if (configModule.get().credentials.avatar && configModule.get().credentials.avatar !== null) {
        const reg = new RegExp(/^(http(s)?:\/\/.)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&\/\/=]*)$/, 'gi');
        if (reg.test(configModule.get().credentials.avatar)) {
            request({
                url: configModule.get().credentials.avatar,
                encoding: null,
            }, (error, response, body) => {
                if (!error && response.statusCode == 200) {
                    setAvatar(new Buffer(body).toString('base64'));
                } else {
                    console.log(chalk.red('The avatar could not be set. Make sure the path is correct.'));
                }
            });
        } else {
            setAvatar(fs.readFileSync(configModule.get().credentials.avatar, 'base64'));
        }
    } else if (configModule.get().credentials.avatar === null) {
        bot.editUserInfo({
            avatar: null,
            password: configModule.get().credentials.password,
        });
    }

    // Accept the invites defined in the config.json
    if (configModule.get().invites) {
        for (const invite of configModule.get().invites) {
            const inviteID = invite.replace('https://discord.gg/', '');
            if (inviteID.length <= 0) {
                continue;
            }

            bot.acceptInvite(inviteID);
        }
    }

    // Listen for update events
    events.on('update', data => {
        // Send private message to owner
        if (configModule.get().ownerID) {
            bot.sendMessage({
                to: configModule.get().ownerID,
                message: 'There is a new version available for the bot.\n\n'
                    + 'Visit <https://github.com/simonknittel/discord-bot-api> to download the latest version.\n'
                    + 'Check out the CHANGELOG.md file for important changes.\n\n'
                    + 'Your version: ' + data.currentVersion + '\n'
                    + 'Latest version: ' + data.latestVersion + '\n',
            });
        }
    });
});

// Try to reconnect
bot.on('disconnected', () => {
    clearInterval(reconnectInterval);

    console.log(chalk.red('Discord Bot API disconnected.'));
    console.log('Trying to reconnect ...');
    console.log(''); // Empty line

    reconnectInterval = setInterval(() => {
        bot.connect();
    }, 15000);
});

// Trigger on incomming message
bot.on('message', handleMessage);

// Make the discord instance, API endpoints and config available for plugins
export default bot;
