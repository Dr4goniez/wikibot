/********************** DEPENDENCIES **********************/

const lib = require('./lib');

//********************** MAIN FUNCTION **********************/

var UserAN;
const Logids = {}, // {logid: username, logid2: username2...}
      Diffs = {}; // {diffid: username, diffid2: username2...} (These objects keep their values)
/**
 * @param {string} pagename 
 * @param {string} token
 * @param {boolean} checkGlobal
 * @param {string} [edittedTs] Timestamp of last edit
 * @returns {Promise<string|undefined>} JSON timestamp if the target page is editted
 */
async function markup(pagename, token, checkGlobal, edittedTs) {

    // Initialize array
    UserAN = [];

    // Get page content
    const parsed = await lib.getLatestRevision(pagename);
    if (!parsed) return console.log('Failed to parse the page.');
    const wikitext = parsed.content;
    var templates = lib.getOpenUserANs(wikitext);
    if (templates.length === 0) return console.log('Procedure cancelled: There\'s no UserAN to update.');

    // Remove redundant UserANs
    templates = templates.filter(template => !template.match(/\|\s*bot\s*=\s*no/)); // Remove UserANs with a bot=no parameter

    // Create an array of objects out of the templates
    for (const tl of templates) {
        UserAN.push({
            'old': tl,
            'new': '',
            'modified': '',
            'timestamp': '',
            'section': '',
            'user': '',
            'type': '',
            'logid': '',
            'diff': '',
            'none': '',
            // The following gets a value if the user reported by the UserAN has been blocked
            'domain': '', // Like partial block, global block, and global lock
            'duration': '',
            'flags': '',
            'date': '',
        });
    }
    
    // RegExps to evaluate the templates' parameters
    const paramsRegExp = {
        'bot': /'^\s*bot\s*=/, // bot=
        'user': /^\s*(?:1|[Uu]ser)\s*=/, // Template param: 1=, user=, or User=
        'type': /^\s*(?:t|[Tt]ype)\s*=/, // Template param: t=, type=, or Type=
        'statusS': /^\s*(?:??????|s|[Ss]tatus)\s*=/, // Template param: ??????=, s=, status=, or Status=. ??? Closed verson
        'section': /={2,5}[^\S\r\n]*.+[^\S\r\n]*={2,5}/g // == sectiontitle == (2-5 levels)
    };

    // Set the 'type', 'user', 'section', and 'timestamp' properties of the object
    UserAN.forEach(obj => {

        var params = lib.getTemplateParams(obj.old);
        params = params.filter(item => !item.match(paramsRegExp.bot) && !item.match(paramsRegExp.statusS)); // Remove bot= and ??????= params

        /**********************************************************************************************************\
            A full list of open UserANs' parameter combinations
                [(1=)username]
                [(1=)username, ??????=] => [(1=)username]
                [t=TYPE, (1=)username]
                [t=TYPE, (1=)username, ??????=] => [t=TYPE, (1=)username]
            Now we can differentiate these four in whether they have a t= param
        \***********************************************************************************************************/

        if (params.length > 2) return; // Contains an undefined parameter

        if (params.filter(item => item.match(paramsRegExp.type)).length === 0) { // If the template doesn't have a t= param
            obj.type = 'user2';
            obj.user = params[0].replace(/\u200e/g, '').trim();
        } else { // If the template has a t= param
            obj.type = params.filter(item => item.match(paramsRegExp.type))[0].replace(paramsRegExp.type, '').replace(/\u200e/g, '').trim().toLowerCase();
            var userParam = params.filter(item => !item.match(paramsRegExp.type))[0].replace(paramsRegExp.user, '').replace(/\u200e/g, '').trim();
            if (lib.isIPv6(userParam)) userParam = userParam.toUpperCase();
            switch (obj.type) {
                case 'user2':
                case 'unl':
                case 'usernolink':
                    obj.user = userParam;
                    if (lib.isIPAddress(userParam)) {
                        obj.modified = `{{UserAN|t=IP2|${userParam}}}`;
                        obj.type = 'ip2';
                    }
                    break;
                case 'ip2':
                case 'ipuser2':
                    obj.user = userParam;
                    if (!lib.isIPAddress(userParam)) {
                        obj.modified = `{{UserAN|${userParam}}}`;
                        obj.type = 'user2';
                    }
                    break;
                case 'log':
                case 'logid':
                    if (userParam.match(/^\d+$/)) obj.logid = userParam; // Make sure that the user param is only of numerals
                    break;
                case 'dif':
                case 'diff':
                    if (userParam.match(/^\d+$/)) obj.diff = userParam;
                    break;
                case 'none': // UserANs with this type param have a random string in the username param (the block status can't be checked)
                    obj.none = userParam;
                    break;
                default: // Invalid type
                    if (lib.isIPAddress(userParam)) {
                        obj.user = userParam;
                        obj.type = 'ip2';
                        obj.modified = `{{UserAN|t=IP2|${userParam}}}`;
                    }
            }
        }

        // Get a timestamp for obj
        const wtSplit = lib.splitInto2(wikitext, obj.old, true); // Split the source text at the template and find the first signature following it
        var ts = wtSplit[1].match(/(\d{4})???(\d{1,2})???(\d{1,2})??? \(.{1}\) (\d{2}:\d{2}) \(UTC\)/); // YYYY???MM???DD??? (???) hh:mm (UTC)
        if (!ts) return;
        for (let i = 2; i <= 3; i++) {
            ts[i] = ts[i].length === 1 ? '0' + ts[i] : ts[i]; // MM and DD may be of one digit but they need to be of two digits
        }
        ts = `${ts[1]}-${ts[2]}-${ts[3]}T${ts[4]}:00Z`; // YYYY-MM-DDThh:mm:00Z (hh:mm is one capturing group)
        obj.timestamp = ts;

        // Get a section title
        const mtch = lib.splitInto2(wikitext, obj.old)[0].match(paramsRegExp.section); // Split the srctxt at tpl and get the last section title in arr[0]
        if (mtch) obj.section = mtch[mtch.length - 1].replace(/(^={2,5}[^\S\r\n]*|[^\S\r\n]*={2,5}$)/g, ''); // Remove '='s

    });
    UserAN = UserAN.filter(obj => obj.user || obj.logid || obj.diff); // Remove UserANs that can't be forwarded to block check

    // Get an array of logids and diff numbers (these need to be converted to usernames through API requests before block check)
    const logids = UserAN.filter(obj => obj.logid && !obj.user && !Logids[obj.logid]).map(obj => obj.logid);
    const diffs = UserAN.filter(obj => obj.diff && !obj.user && !Diffs[obj.diff]).map(obj => obj.diff);

    // Convert logids and diffids to usernames through API queries (for logids, only search for the latest 5000 logevents)
    var queries = [];
    queries.push(convertLogidsToUsernames(logids), convertDiffidsToUsernames(diffs)); // These functions save the response into Logids and Diffs
    await Promise.all(queries);
    UserAN.forEach(obj => { // Set the 'user' property of UserAN if possible
        if (obj.logid && !obj.user && Logids[obj.logid]) obj.user = Logids[obj.logid];
        if (obj.diff && !obj.user && Diffs[obj.diff]) obj.user = Diffs[obj.diff];
    });

    // Sort registered users and IPs
    var users = UserAN.filter(obj => obj.user).map(obj => obj.user);
    const ips = users.filter(username => lib.isIPAddress(username)); // An array of IPs
    users = users.filter(username => !lib.isIPAddress(username)); // An array of registered users

    // Check if the users and IPs in the arrays are locally blocked
    queries = [];
    queries.push(getBlockedUsers(users), getBlockedIps(ips)); // Get domain/duration/date properties of UserAN if blocked
    await Promise.all(queries); // Wait until all the async procedures finish

    // --- At this point, UserANs to mark up have a 'duration' property ---

    // Check if the users and IPs in the arrays are globally (b)locked
    if (checkGlobal) {
        let gUsers = UserAN.filter(obj => obj.user && !obj.duration).map(obj => obj.user); // Only check users that aren't locally blocked
        const gIps = gUsers.filter(username => lib.isIPAddress(username));
        gUsers = gUsers.filter(username => !lib.isIPAddress(username));
        queries = [];
        queries.push(getLockedUsers(gUsers), getGloballyBlockedIps(gIps));
        await Promise.all(queries);
    }

    // --- At this point, UserANs to mark up have a 'duration' or 'domain' property ---

    // Final check before edit
    var modOnly = false; // True if no user is newly blocked but some UserANs need to be modified
    if (UserAN.some(obj => obj.domain || obj.duration)) { // Someone is newly blocked
        if (UserAN.some(obj => obj.modified)) UserAN.filter(obj => obj.modified).forEach(obj => obj.new = obj.modified);
        UserAN.filter(obj => obj.domain || obj.duration).forEach(obj => { // Get new UserANs to replace old ones with
            const replacee = obj.modified ? obj.modified : obj.old;
            obj.new = replacee.replace(/\|*\}{2}$/, '') + '|' + obj.domain + obj.duration + obj.flags + obj.date + '}}';
        });
    } else if (UserAN.some(obj => obj.modified)) {
        modOnly = true;
        UserAN.filter(obj => obj.modified).forEach(obj => obj.new = obj.modified); // Get the modified UserANs to replace old ones with
    } else {
        return console.log('Procedure cancelled: There\'s no UserAN to update.');
    }

    // Get summary
    var summary = '';
    if (!modOnly) {

        const getUserLink = (obj) => {
            if (obj.type.match(/^(?:user2|unl|usernolink)$/)) {
                const maxLetterCnt = containsJapaneseCharacter(obj.user) ? 10 : 20;
                if (obj.user.length > maxLetterCnt) {
                    return `${obj.user.substring(0, maxLetterCnt)}.. (${obj.domain}${obj.duration})`;
                } else {
                    return `[[??????:????????????/${obj.user}|${obj.user}]] (${obj.domain}${obj.duration})`;
                }
            } else if (obj.type.match(/^(?:ip2|ipuser2)$/)) {
                return `[[??????:????????????/${obj.user}|${obj.user}]] (${obj.domain}${obj.duration})`;
            } else if (obj.type.match(/^(?:log|logid)$/)) {
                return `[[??????:??????/logid/${obj.logid}|Logid/${obj.logid}]] (${obj.domain}${obj.duration})`;
            } else if (obj.type.match(/^(?:dif|diff)$/)) {
                return `[[??????:??????/${obj.diff}|??????/${obj.diff}]]???????????? (${obj.domain}${obj.duration})`;
            }
        };

        const sections = UserAN.filter(obj => obj.new).map(obj => obj.section).filter((item, i, arr) => arr.indexOf(item) === i);
        if (sections.length > 1) { // If the bot is to mark up UserANs in multiple sections

            summary = 'Bot:';
            const reportsBySection = UserAN.filter(obj => obj.new && (obj.domain || obj.duration)).reduce((acc, obj, i) => {
                if (!acc[obj.section]) acc[obj.section] = [{...obj}];                       // {section1: [{ user: username, ...}],
                if (i !== 0 && acc[obj.section].every(obj2 => obj2.user !== obj.user)) {    //  section2: [{ user: username, ...}],
                    acc[obj.section].push({...obj});                                        //  ... } ### UserANs to update in each section
                }                                    // Push the object iff loop cnt != 0 & the relevant username isn't in the array of objects
                return acc;                          // (This prevents the output involving the same username: One user could be reported multiple
            }, Object.create(null));                 //  times in the same section)

            for (let key in reportsBySection) {
                summary += ` /*${key}*/ `;
                const bool = reportsBySection[key].every((obj, i) => {
                    let tempSummary = (i === 0 ? getUserLink(obj) : ', ' + getUserLink(obj));
                    if ((summary + tempSummary).length <= 500) { // Prevent the summary from exceeding the max word count
                        summary += tempSummary;
                        return true; // Go on to the next loop
                    } else {
                        summary += ' ??????';
                        return false; // Exit the loop
                    }
                });
                if (!bool) break; // array.every() returned false, which means the summary reached the word count limit
            }

        } else { // If the bot is to mark up UserANs in one section

            const userlinksArr = [];
            UserAN.filter(obj => obj.new && (obj.domain || obj.duration)).forEach((obj, i) => {
                const userlink = getUserLink(obj);
                if (!userlinksArr.includes(userlink)) { // Prevent the same links from being displayed
                    summary += (i === 0 ? userlink : ', ' + userlink);
                    userlinksArr.push(userlink);
                }
            });
            summary = `/*${sections[0]}*/ Bot: ` + summary;

        }

    } else {
        summary = 'Bot: UserAN?????????';
    }

    // Get the latest revision and its timestamp(s)
    if (edittedTs) await lib.dynamicDelay(edittedTs);
    const lr = await lib.getLatestRevision(pagename);
    if (!lr) return 'Failed to get the latest revision.';
    var newContent = lr.content;

    // Update UserANs in the source text
    UserAN.filter(obj => obj.new).forEach(obj => newContent = newContent.split(obj.old).join(obj.new));

    // Edit the page
    const params = {
        'action': 'edit',
        'title': pagename,
        'text': newContent,
        'summary': summary,
        'minor': true,
        'basetimestamp': lr.basetimestamp,
        'starttimestamp': lr.curtimestamp,
        'token': token
    };
    if (modOnly) params.bot = true;

    const result = await lib.api.request(params).then(res => {
        if (res && res.edit) {
            if (res.edit.result === 'Success') return true;
        }
        return false;
    }).catch((err) => resolve(err));

    switch (result) {
        case true:
            console.log('Edit done.');
            return new Date().toJSON().replace(/\.\d{3}Z$/, 'Z');
        case false:
            return console.log('Edit failed due to an unknown error.');
        default:
            return console.log('Edit failed: ' + result);
    }

}
module.exports.markup = markup;

//********************** UTILITY FUNCTIONS **********************/

async function convertLogidsToUsernames(arr) {

    if (arr.length === 0) return [];
    var logidsArr = JSON.parse(JSON.stringify(arr));
    var cnt = 0;
    return await logidQuery();

    function logidQuery(lecontinue) {
        cnt++;
        return new Promise(resolve => {
            lib.api.request({
                'action': 'query',
                'list': 'logevents',
                'leprop': 'ids|title',
                'letype': 'newusers',
                'lelimit': 'max',
                'lecontinue': lecontinue,
                'formatversion': 2
            }).then(async res => {
                var resLgEv;
                if (!res || !res.query) return resolve();
                if ((resLgEv = res.query.logevents).length === 0) return resolve();
                resLgEv.forEach(obj => {
                    if (typeof obj.title === 'undefined') return;
                    const logid = obj.logid.toString();
                    if (!Logids[logid]) Logids[logid] = obj.title.replace(/^?????????:/, '');
                });
                logidsArr = logidsArr.filter(item => !Logids[item]); // Remove logids that have already been converted
                if (logidsArr.length !== 0 && res.continue && cnt <= 10) await logidQuery(res.continue.lecontinue);
                resolve();
            }).catch(err => resolve(console.log(err)));
        });
    }

}

async function convertDiffidsToUsernames(arr) {
    if (arr.length === 0) return [];
    return new Promise(resolve => {
        lib.api.request({
            'action': 'query',
            'revids': arr.slice(0, 500).join('|'),
            'prop': 'revisions',
            'formatversion': 2
        }).then(res => {
            var resPgs;
            if (!res || !res.query) return resolve();
            if ((resPgs = res.query.pages).length === 0) return resolve();
            resPgs.forEach(page => {
                let revid = page.revisions[0].revid.toString();
                if (!Diffs[revid]) Diffs[revid] = page.revisions[0].user;
            });
            resolve();
        }).catch(() => resolve(returnArr));
    });
}

async function getBlockedUsers(usersArr) {

    if (usersArr.length === 0) return;
    const users = JSON.parse(JSON.stringify(usersArr));
    const queries = [];
    while (users.length !== 0) {
        queries.push(blockQuery(users.slice(0, 500)));
        users.splice(0, 500);
    }
    await Promise.all(queries);
    return;

    function blockQuery(arr) {
        return new Promise(resolve => {
            lib.api.request({
                'action': 'query',
                'list': 'blocks',
                'bklimit': 'max',
                'bkusers': arr.join('|'),
                'bkprop': 'user|timestamp|expiry|restrictions|flags',
                'formatversion': 2
            }).then(res => {
                var resBlck;
                if (!res || !res.query) return resolve();
                if ((resBlck = res.query.blocks).length === 0) return resolve();
                for (const blck of resBlck) {
                    const nousertalk = !blck.allowusertalk,
                          noemail = blck.noemail,
                          partial = blck.restrictions && !Array.isArray(blck.restrictions),
                          indef = blck.expiry === 'infinity';
                    UserAN.forEach(obj => {
                        if (obj.user === blck.user) {
                            const newlyReported = lib.compareTimestamps(obj.timestamp, blck.timestamp, true) >= 0;
                            if (newlyReported) {
                                obj.duration = indef ? '?????????' : lib.getDuration(blck.timestamp, blck.expiry);
                                obj.date = getBlockedDate(blck.timestamp);
                                obj.domain = partial ? '?????????????????? ' : '';
                                if (nousertalk && noemail) {
                                    obj.flags = ' ??????????????????????';
                                } else if (nousertalk) {
                                    obj.flags = ' ????????';
                                } else if (noemail) {
                                    obj.flags = ' ???????????';
                                }
                            }
                        }
                    });
                }
                resolve();
            }).catch((err) => resolve(console.log(err)));
        });
    }
}

async function getBlockedIps(ipsArr) {

    if (ipsArr.length === 0) return;
    const queries = [];
    for (let i = 0; i < ipsArr.length; i++) queries.push(blockQuery(ipsArr[i]));
    await Promise.all(queries);
    return;

    function blockQuery(ip) {
        return new Promise(resolve => {
            lib.api.request({
                'action': 'query',
                'list': 'blocks',
                'bklimit': 1,
                'bkip': ip,
                'bkprop': 'user|timestamp|expiry|restrictions|flags',
                'formatversion': 2
            }).then(res => {
                var resBlck;
                if (!res || !res.query) return resolve();
                if ((resBlck = res.query.blocks).length === 0) return resolve();
                resBlck = resBlck[0];
                const nousertalk = !resBlck.allowusertalk,
                      noemail = resBlck.noemail,
                      hardblock = !resBlck.anononly,
                      partial = resBlck.restrictions && !Array.isArray(resBlck.restrictions),
                      indef = resBlck.expiry === 'infinity',
                      rangeblock = resBlck.user !== ip && resBlck.user.substring(resBlck.user.length - 3) !== ip.substring(ip.length - 3);
                UserAN.forEach(obj => {
                    if (obj.user === ip) {
                        const newlyReported = lib.compareTimestamps(obj.timestamp, resBlck.timestamp, true) >= 0;
                        if (newlyReported) {
                            obj.duration = indef ? '?????????' : lib.getDuration(resBlck.timestamp, resBlck.expiry);
                            if (rangeblock) obj.duration = resBlck.user.substring(resBlck.user.length - 3) + '???' + obj.duration;
                            obj.date = getBlockedDate(resBlck.timestamp);
                            obj.domain = partial ? '?????????????????? ' : '';
                            if (nousertalk && noemail) {
                                obj.flags = ' ??????????????????????';
                            } else if (nousertalk) {
                                obj.flags = ' ????????';
                            } else if (noemail) {
                                obj.flags = ' ???????????';
                            }
                            if (hardblock) obj.flags = ' ?????????????????????' + (obj.flags ? obj.flags.replace(/^ /, '???') : '');
                        }
                    }
                });
                resolve();
            }).catch((err) => resolve(console.log(err)));
        });
    }

}

/**
 * Get an array of locked users from an array of registered users
 * @param {Array} regUsersArr 
 * @returns {Promise<Array>}
 */
async function getLockedUsers(regUsersArr) {

    if (regUsersArr.length === 0)  return [];

    const glockQuery = user => new Promise(resolve => {
        lib.api.request({
            action: 'query',
            list: 'globalallusers',
            agulimit: 1,
            agufrom: user,
            aguto: user,
            aguprop: 'lockinfo'
        }).then(res => {
            var resLck;
            if (!res || !res.query) return resolve();
            if ((resLck = res.query.globalallusers).length === 0) return resolve(false); // The array is empty: not locked
            resolve(resLck[0].locked !== undefined); // resLck[0].locked === '' if locked, otherwise undefined
        }).catch((err) => resolve(console.log(err)));
    });

    const lockedDate = getBlockedDate();

    const queries = [], lockedUsers = [];
    for (const user of regUsersArr) {
        queries.push(glockQuery(user).then(locked => {
            if (locked) lockedUsers.push(user);
        }));
    }
    await Promise.all(queries);
    lockedUsers.forEach(username => {
        UserAN.forEach(obj => {
            if (obj.user === username) {
                obj.domain = '????????????????????????';
                obj.date = lockedDate;
            }
        });
    });

}

async function getGloballyBlockedIps(arr) {

    if (arr.length === 0) return;

    const gblockQuery = ip => {
        return new Promise(resolve => {
            lib.api.request({
                'action': 'query',
                'list': 'globalblocks',
                'bgip': ip,
                'bglimit': 1,
                'bgprop': 'address|expiry|timestamp',
                'formatversion': 2
            }).then(res => {
                var resGblck;
                if (!res || !res.query) return resolve();
                if ((resGblck = res.query.globalblocks).length === 0) return resolve(); // If the array in the reponse is empty, the IP isn't g-blocked
                resGblck = resGblck[0];
                const indef = (resGblck.expiry === 'infinity');
                UserAN.forEach(obj => {
                    if (obj.user === ip) {
                        const newlyReported = lib.compareTimestamps(obj.timestamp, resGblck.timestamp, true) >= 0;
                        let duration;
                        if (newlyReported) {
                            if (!indef) duration = lib.getDuration(resGblck.timestamp, resGblck.expiry);
                            obj.duration = indef ? '?????????' : duration;
                            obj.date = getBlockedDate(resGblck.timestamp);
                            obj.domain = '??????????????????????????? ';
                        }
                    }
                });
                resolve();
            }).catch((err) => resolve(console.log(err)));
        });
    };

    const queries = [];
    for (const ip of arr) queries.push(gblockQuery(ip));
    await Promise.all(queries);

}

/**
 * Get ' (MM/DD)' from a JSON timestamp or the current time
 * @param {string} [timestamp] JSON timestamp in UTC
 * @returns {string} ' (MM/DD)'
 */
 function getBlockedDate(timestamp) {
    const d = timestamp ? new Date(timestamp) : new Date();
    d.setHours(d.getHours() + 9);
    return ` (${d.getMonth() + 1}/${d.getDate()})`;
}

/**
 * Check if a string contains a Japanese character
 * @param {string} str
 * @returns {boolean}
 */
function containsJapaneseCharacter(str) {
    return str.match(/[\u30a0-\u30ff\u3040-\u309f\u3005-\u3006\u30e0-\u9fcf]+/) ? true : false;
}