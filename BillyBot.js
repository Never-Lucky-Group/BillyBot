// ------------------------------------------------------------------------------------------------------
// *
// * Helpful Links
// *
// ------------------------------------------------------------------------------------------------------

// DiscordJS

// Voice Connections:
// https://discordjs.guide/voice/voice-connections.html#cheat-sheet

// Audio Player:
// https://discordjs.guide/voice/audio-player.html#creation

// ------------------------------------------------------------------------------------------------------
// *
// * Dependencies
// *
// ------------------------------------------------------------------------------------------------------

// token and prefix
const {
  prefix,
  token,
} = require('./config.json');

// add timestamps in front of log messages
require('console-stamp')(console, '[HH:MM:ss.l]');

// Discordjs
const { Client, GatewayIntentBits, Events, Partials, EmbedBuilder } = require('discord.js');
const { PermissionsBitField } = require('discord.js');
const { ChannelType } = require('discord.js');
const { StreamType } = require('@discordjs/voice');
const { AudioPlayerStatus } = require('@discordjs/voice');
const { joinVoiceChannel } = require('@discordjs/voice');
const { getVoiceConnection } = require('@discordjs/voice');
const { createAudioResource } = require('@discordjs/voice');
const { createAudioPlayer } = require('@discordjs/voice');
const { entersState } = require('@discordjs/voice');
const { VoiceConnectionStatus } = require('@discordjs/voice');

// File System Extra
const fs = require('fs-extra');

const { spawn } = require('child_process');

// ------------------------------------------------------------------------------------------------------
// *
// * Setup
// *
// ------------------------------------------------------------------------------------------------------

// Declare intents
const client = new Client({ intents: [ 
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildPresences,
  GatewayIntentBits.DirectMessages], partials: [Partials.Channel, Partials.Message] });

// Login to Discord
client.login(token);

client.once(Events.ClientReady, () => {
  console.log(`Ready. Logged in as ${client.user.tag}!`);
  listDiscordServers();
});

//
const discordServerMap = new Map();


// ------------------------------------------------------------------------------------------------------
// *
// * Event Subscriptions
// *
// ------------------------------------------------------------------------------------------------------

// Subscribe to message create event
client.on('messageCreate', async message => {
  
  // If it is our own message, ignore
  if (message.author.bot)
    return;

  // No guild ID
  if (!message.guild)
    checkDms(message);

  // Does the message start with our prefix
  if (!message.content.startsWith(prefix))
    return;

  // !help command
  if (message.content.startsWith(`${prefix}help`)) 
  {
    message.member.send(globalHelpString());
    return;
  }

  // !patchnotes command
  if(message.content.startsWith(`${prefix}patchnotes`))
  {
    message.channel.send(patchnotesString());
    return;
  }

  // !skip command
  if(message.content.startsWith(`${prefix}skip`))
  {
    skipSong(message);
    return;
  }

  if (message.content.startsWith(`${prefix}queue`))
  {
    showQueueEmbed(message);
    return;
  }

  // !leave command
  if(message.content.startsWith(`${prefix}leave`))
  {
    leaveServer(message.guild.id);
    return;
  }

  if(message.content.startsWith(`${prefix}play`))
  {
    // check permissions
    if (checkCommandPermissions(message))
      return;

    // TODO: Don't call this function once youtube search is implemented
    // make sure formatting is correct
    if(checkCommandFormatting(message))
      return;

    const url = await getUrl(message);

    // Make sure the url extraction was successfull (mostly for spotify)
    if(url.includes('youtube.com') || url.includes('youtu.be'))
      downloadSong(url, message);

    return;
  }

});

// Subscribe to users joining/leaving channels
client.on('voiceStateUpdate', (oldState, newState) => {
  // Get the guild ID
  const guildId = oldState.guild.id;

  // Get the current voice connection (if any)
  const connection = getVoiceConnection(guildId);
  if (!connection)
   return;

  // Get the voice channel BillyBot is in
  const billyChannelId = connection.joinConfig.channelId;
  const billyChannel = oldState.guild.channels.cache.get(billyChannelId);

  if (!billyChannel || billyChannel.type !== ChannelType.GuildVoice) return;

  // Check how many members are in that voice channel (excluding bots if you want)
  const membersLeft = billyChannel.members.filter(member => !member.user.bot);

  // If no non-bot users are left, leave
  if (membersLeft.size === 0) {
    console.log(`BillyBot is alone in ${billyChannel.name}. Leaving...`);
    leaveServer(guildId);
  }
});

// ------------------------------------------------------------------------------------------------------
// *
// * File functions
// *
// ------------------------------------------------------------------------------------------------------

function downloadSong(url, message)
{
  // Create directory if it doesn't exist yet
  const dir = `./songs/${message.guild.id}`;

  if(!fs.existsSync(dir))
    fs.mkdirSync(dir);

  // yt-dlp --print after_move:filepath  --extract-audio --audio-format mp3 --restrict-filenames --no-playlist -P "./songs" -o "%(title)s.%(ext)s" "https://www.youtube.com/watch?v=4aEj-wKkMu0"

  //const command = `yt-dlp --print after_move:filepath  --extract-audio --audio-format mp3 --restrict-filenames --no-playlist -P "${dir}" "%(title)s.%(ext)s" "${url}"`;

  const command = 'yt-dlp';

  const args = [
    '--no-simulate',
    '--js-runtimes', 'node',
    '--extract-audio',
    '--audio-format', 'mp3',
    '--restrict-filenames',
    '--no-playlist',
    '-P', `${dir}`,
    '-o', `%(title)s.%(ext)s`,
    '--print', '%(title)s',
    '--print', '%(thumbnail)s',
    '--print', '%(duration)s',
    '--print', 'after_move:filepath',
    url
  ];

  const options = {cwd: 'REDACTED_PATH', timeout: 30000}; // 30 seconds

  const childProcess = spawn(command, args, options);

  let stdoutLines = [];

  childProcess.stdout.on('data', (data) => {     
    stdoutLines.push(...data.toString().split(/\r?\n/).filter(Boolean));
  });


  childProcess.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
    filePath = null;
  });

  // New
  childProcess.on('close', (code) => {
    let filePath = null;
    let title = null;
    let thumbnail = null;
    let duration = null;

    if (stdoutLines.length >= 4) {
      [title, thumbnail, duration, filePath] = stdoutLines;
    } else if (stdoutLines.length >= 1) {
      // Only got file path back
      filePath = stdoutLines[stdoutLines.length - 1];
    } else {
      console.warn('yt-dlp output incomplete. Got:', stdoutLines);
    }

    // Fallbacks
    title = title || 'Unknown Title';
    thumbnail = thumbnail || null;
    duration = duration || null;
    filePath = filePath ? filePath.trim() : null;

    if (!filePath) {
      console.error('No valid file path. Skipping song.');
      message.channel.send('Failed to download audio.');
      return;
    }

    console.log(`Queuing song: ${title} (${filePath})`);

    addSongToQueue(filePath, url, title, thumbnail, duration, message);
  });
}


// ------------------------------------------------------------------------------------------------------
// *
// * Async functions
// *
// ------------------------------------------------------------------------------------------------------

async function getUrl(message)
{
  const command = message.content;

  if(command.includes('youtube.com') || command.includes('youtu.be'))
  {
    var url = command.substring(command.indexOf('https://'));

    return url;
  }
  else if(command.includes('open.spotify.com'))
  {
    // TODO: Ardy spotify code goes here
  }
  else
  {
    // TODO: Ardy youtube search code goes here
  }

}

// ------------------------------------------------------------------------------------------------------
// *
// * Helper functions
// *
// ------------------------------------------------------------------------------------------------------

async function playSong(serverID, song)
{
  const serverObject = discordServerMap.get(serverID);

  var connection = getVoiceConnection(serverID);

  console.log(`Trying to play: ${song.filePath}`);
  console.log(`File exists: ${fs.existsSync(song.filePath)}`);
  console.log(`File size: ${fs.statSync(song.filePath).size} bytes`);

  let resource = createAudioResource(song.filePath.toString());

  if(!connection)
  {
    connection = joinVoiceChannel({
      channelId: serverObject.voiceChannel.id,
      guildId: serverID,
      adapterCreator: serverObject.voiceChannel.guild.voiceAdapterCreator,
    });

    connection.on('stateChange', (oldState, newState) => {
      console.log(
        `Voice state: ${oldState.status} -> ${newState.status}`
      );
    });

    const perms = serverObject.voiceChannel.permissionsFor(
      serverObject.voiceChannel.guild.members.me
    );

    console.log("Connect:", perms.has("Connect"));
    console.log("Speak:", perms.has("Speak"));

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      console.error('Voice connection failed:', error);
      return;
    }

    connection.subscribe(serverObject.audioPlayer);
  }

  serverObject.audioPlayer.play(resource);

  //serverObject.textChannel.send(`${song.user} has played ${song.link}`);
  const playEmbed = new EmbedBuilder()
  .setColor(0x1DB954) // Spotify green 😎
  .setTitle('🎶 Now Playing')
  .setURL(song.link)
  .setDescription(song.title)
  .setThumbnail(song.thumbnail)
  .addFields(
    { name: 'Requested by', value: song.user.username, inline: true },
    { name: 'Duration', value: formatDuration(song.duration), inline: true }
  )
  .setTimestamp()
  .setFooter({ text: 'BillyTube' });

  serverObject.textChannel.send({ embeds: [playEmbed] });
}

function skipSong(message)
{
  const connection = getVoiceConnection(message.guild.id);

  if(connection)
  {
    const serverObject = discordServerMap.get(message.guild.id);

    if(serverObject)
    {
      if(serverObject.audioPlayer)
      {
        if(serverObject.audioPlayer.state.status === AudioPlayerStatus.Playing)
        {
          // Check if there are more songs in the queue
          if(serverObject.queue.length)
            playSong(message.guild.id, serverObject.queue.shift());
          else
            serverObject.audioPlayer.stop();
        }
        else
          message.channel.send("There is no active song playing.");
      }
    }
  }
  else
  {
    message.channel.send("I need to be in a voice channel to skip songs.");
  }
}

function processQueue(serverID)
{
  const serverObject = discordServerMap.get(serverID);

  if(serverObject)
  {
    if(serverObject.audioPlayer)
    {
      if(serverObject.audioPlayer.state.status === AudioPlayerStatus.Idle)
      {
        // Check if there are more songs in the queue
        if(serverObject.queue.length)
          playSong(serverID, serverObject.queue.shift());
      }
    }
  }
}

function addSongToQueue(pFilePath, pLink, pTitle, pThumbNail, pDuration, message)
{
  var serverObject = discordServerMap.get(message.guild.id);

  if(!serverObject)
  {
    // Create the structure containing all the data we need to track per server
    const newServerObject = {
        textChannel: message.channel,               // The text channel the user is typing commands in
        voiceChannel: message.member.voice.channel, // The voice channel the user is currently in 
        audioPlayer: null,                          // The discordjs audio player object 
        queue: [],                                  // The queue of song requests
        volume: 3                                   // The volume of the discordjs audio player
      };

    // Instances of song requests inside the queue                                
    const song = {
      filePath: pFilePath,          // The file path 
      link: pLink,                  // The url link
      title: pTitle,                // The song title
      thumbnail: pThumbNail,        // The song thumbnail
      duration: pDuration,          // The song duration
      user: message.author          // The user who requested the song
    };

    newServerObject.queue.push(song);

    discordServerMap.set(message.guild.id, newServerObject);

    serverObject = discordServerMap.get(message.guild.id);
    serverObject.audioPlayer = createAudioPlayer();

    // Subscribe to Idle state
    serverObject.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      processQueue(message.guild.id);
    });

    serverObject.audioPlayer.on('error', error => {
      console.error(`Error: ${error.message} with resource ${error.resource.metadata.title}`);
    });
  }
  else
  {
    // Instances of song requests inside the queue                                
    const song = {
      filePath: pFilePath,          // The file path 
      link: pLink,                  // The url link
      title: pTitle,                // The song title
      thumbnail: pThumbNail,        // The song thumbnail
      duration: pDuration,          // The song duration
      user: message.author          // The user who requested the song
    };

    serverObject.queue.push(song);

    if(serverObject.audioPlayer.state.status === AudioPlayerStatus.Playing)
    {
      const queueEmbed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('Added to Queue')
      .setURL(song.link)
      .setDescription(song.title)
      .setThumbnail(song.thumbnail)
      .addFields(
        { name: 'Requested by', value: song.user.username, inline: true },
        { name: 'Duration', value: formatDuration(song.duration), inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'BillyTube' });

      message.channel.send({ embeds: [queueEmbed] });
    }

  }

  processQueue(message.guild.id);
}

function showQueueEmbed(message)
{
  const serverObject = discordServerMap.get(message.guild.id);

  if (!serverObject || !serverObject.queue.length) {
    message.channel.send('The queue is currently empty.');
    return;
  }

  const queueList = serverObject.queue.map((song, index) => {
    const duration = song.duration ? ` \`[${formatDuration(song.duration)}]\`` : '';
    return `**${index + 1}.** ${song.title || 'Untitled'}${duration} – *${song.user.username}*`;
  }).slice(0, 10); // Limit to top 10 for embed size limits

  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle('🎶 Current Queue')
    .setDescription(queueList.join('\n'))
    .setFooter({ text: `Total in queue: ${serverObject.queue.length}` })
    .setTimestamp();

  message.channel.send({ embeds: [embed] });
}

function audioPlayerCheck(message)
{
  const serverObject = discordServerMap.get(message.guild.id);

  if(serverObject)
  {
    if(serverObject.audioPlayer)
    {
      console.log(`AudioPlayer Status: ${serverObject.audioPlayer.state.status}`);
    }
  }
}

function leaveServer(serverID)
{
  const connection = getVoiceConnection(serverID);

  if(connection)
  {
    connection.destroy();

    const audioPlayer = discordServerMap.get(serverID).audioPlayer;

    if(audioPlayer)
      audioPlayer.stop();

    discordServerMap.delete(serverID);

    // Delete all the files in the appropriate server folder
    const path = `./songs/${serverID}`;

    fs.emptyDir(path, err => {

      if (err)
        return console.error(err);

      console.log('Deleted all files in ' + path);
    })
  }
}

// List all servers we are logged into
function listDiscordServers()
{
  let discordServers = client.guilds.cache;

  discordServers.each(guild => {
    console.log(`${guild.name} | ${guild.id}`);
  });
}

function checkCommandPermissions(message)
{
  // safety check
  if(message.content == null)
  {
    message.channel.send("Oops. Can't do that.");
    return true;
  }

  // Channel permissions
  if(message.channel.name != "music_bot")
  {
    message.channel.send(message.author.toString() + " please use the music_bot channel to use BillyTube.");
    return true;
  }

  // In voice channel permission
  const voiceChannel = message.member.voice.channel;

  if (!voiceChannel)
  {
    message.channel.send("You need to be in a voice channel to play Billy.");
    return true;
  }
  // Make sure Billy isn't already in a different voice channel in this server
  // else
  // {
  //   const connection = getVoiceConnection(message.guild.id);

  //   if(connection)
  //   {
  //     // TODO: this might not work
  //     if(connection.channelId != voiceChannel.id)
  //     {
  //       message.channel.send("You need to be in the same voice channel as Billy is currently in.");
  //       return true;
  //     }
  //   }
  // }

  // Role permissions
  if (!message.member.roles.cache.some(role => role.name === 'DJ'))
  {
    message.channel.send(message.author.toString() + " I'm sorrrry. You don't have the required privleges to use BillyTube.");
    return true;
  }
}

function checkCommandFormatting(message)
{
  const command = message.content;

  // if (command.includes('list='))
  // {
  //   message.channel.send("Playlists are not supported. Please give a link to an individual song.");
  //   return true;
  // }

  //if(!(command.includes('youtube.com') || command.includes('open.spotify.com')))
  if(!(command.includes('youtube.com') || command.includes('youtu.be')))
  {
    message.channel.send("Only links from www.youtube.com are supported.");
    return true;
  }
}

function checkDms(message)
{
  if(message.channel.type === ChannelType.DM)
  {
    const dm = message.content.toLowerCase();

    if(dm == "help")
      message.author.send(globalHelpString());
    else if(dm == "patchnotes")
      message.author.send(patchnotesString());
    else
      easterEggDM(dm, message);
  }
}

function patchnotesString()
{
  return "BillyBot Patch 3.0:\n\n" 
  + "- BillyBot now only has BillyTube functionality.\n"
  + "- BillyBoard to return in future release.\n";
}

function globalHelpString()
{
  //return "Global commands:\n!help , !patchnotes , !leave , !play [youtube url][spotify url][text search], !skip";
  // TODO: update this when spotify links work
  return "Global commands:\n!help , !patchnotes , !leave , !play [youtube url], !skip, !queue";
}

function easterEggDM(dm, message)
{
  if(dm == "REDACTED")
  {
    if(message.author.id == "REDACTED_USER_ID")
      message.author.send("Hi REDACTED, we love you.")
    else
      message.author.send("You are not REDACTED")
  }
  else if(dm == "REDACTED")
  {
    if(message.author.id == "REDACTED_USER_ID")
      message.author.send("Hi you sexy mother bitch bloody bastard.")
    else
      message.author.send("You are not REDACTED")
  }
  else if(dm == "REDACTED")
  {
    if(message.author.id == "REDACTED_USER_ID")
      message.author.send("Hi REDACTED.")
    else
      message.author.send("Suck my balls")
  }
  else if(dm == "i love you")
    message.author.send("I love you too " + message.author.username);
  else
    message.author.send("I don't understand what you are saying.");
}

function formatDuration(secondsStr) {
  const seconds = parseInt(secondsStr, 10);
  if (isNaN(seconds)) return 'Unknown';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  } else {
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}