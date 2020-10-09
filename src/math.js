function split_b_k(data, b_ids, k_ids, b_name, k_name, address_id) {
    all_ids = b_ids.concat(k_ids);
    var full_data = data.filter(function(row) {
        return all_ids.includes(row.TYPE) && row.ADDRESS === address_id;
    }).map(function(row) {
        if (b_ids.includes(row.TYPE)) {
            return {
                name: b_name,
                date: new Date(parseInt(row.DATE_SENT, 10)),
                ID: row.ID,
                BODY: row.BODY
            }
        } else {  // in k_ids
            return {
                name: k_name,
                date: new Date(parseInt(row.DATE_SENT, 10)),
                ID: row.ID,
                BODY: row.BODY
            };
        }
    });
    return {names: [b_name, k_name], data: full_data};
}

function split_b_k_facebook(text) {
    const json = JSON.parse(text);
    const names = json.participants.map((p) => p.name);
    const data = json.messages.filter((msg) => {
        return msg.type == "Generic" && msg.content;
    }).map( (msg) => {
        return {
            name: msg.sender_name,
            date: new Date(msg.timestamp_ms),
            ID: `${msg.sender_name}_${msg.timestamp_ms}`,
            BODY: decodeURIComponent(escape(msg.content))
        };
    });
    return {
        names: names,
        data: data
    };
}

var datetime_regex = /(([0-9])?[0-9])([\.\/])(([0-9])?[0-9])([\.\/])(\d{2}|\d{4})(,)? (([0-9])?[0-9]):([0-9][0-9])(:[0-9][0-9])?( [aApP]\.?[mM]\.?)?/;
var brace_front = /^\[/;
var no_brace_front = /^/;
var brace_back = /\]/;


function split_b_k_whatsapp(text) {
    let lines = text.split('\n').filter(function(d) { return d.length != 0; });
    let use_braces = '';
    let date_split = '/';
    let use_meridan = '';
    let use_hacky_rm = false;
    let date_regexx = datetime_regex;
    let delim_str = '';
    let idx = 0;
    let test_line = lines[idx].trim();
    while (delim_str == '' && idx < lines.length) {
        if (datetime_regex.test(test_line)) {
            if (test_line[0] == '[') {
                use_braces = '[';
                delim_str = ']';
                date_regexx = new RegExp(brace_front.source +
                                         datetime_regex.source + brace_back.source);
            } else {
                delim_str = '-';
                date_regexx = new RegExp(no_brace_front.source + datetime_regex.source);
            }
        } else {
            idx += 1;
            test_line = lines[idx].trim();
        }
    }

    if (idx == lines.length) {
        console.log('WARNING: did not match a date time anywhere in the file: example line: '
                    + lines[0]);
    }

    let used = lines.reduce(function(used_st, l) {
        if (used_st['regex']) {
            return used_st;
        }
        if (!date_regexx.test(l)) {
            return used_st; // New lines middle of the message likely
        }

        let matches = l.match(date_regexx);
        if (matches[3] && matches[3] == '.' && matches[6] && matches[6] == '.') {
            date_split = '.';
        }
        if (matches[13]) {
            if (matches[13] == ' a.m.' || matches[13] == ' p.m.') {
                use_meridan = ' a';
                use_hacky_rm = true;
            } else {
                use_hacky_rm = false;
                if (matches[13] == ' AM' || matches[13] == ' PM') {
                    use_meridan = ' A';
                } else {
                    use_meridan = ' a';
                }
            }
        }
        let year_str = 'YY';
        if (matches[7]) {
            if (matches[7].length == 2) {
                year_str = 'YY';
            } else if (matches[7].length == 4) {
                year_str = 'YYYY';
            } else {
                console.log('WARNING: Found a strange year format: ' + matches[7] + ', ' + l);
            }
        }
        let seconds_str = '';
        if (matches[12]) {
            seconds_str = ':ss';
        }
        let comma_sep = '';
        if (matches[8]) {
            comma_sep = matches[8];
        }

        if (matches[1] && matches[4]) {
            let first_int = parseInt(matches[1], 10);
            if (first_int > 12) {
                let date_fmt = use_braces + 'D' + date_split + 'M' + date_split + year_str
                    + comma_sep + ' H:mm' + seconds_str + use_meridan;
                return {'regex' : date_regexx, 'delim' : delim_str, 'formats' : [date_fmt]};
            }
            let second_int = parseInt(matches[4], 10);
            if (second_int > 12) {
                let date_fmt = use_braces + 'M' + date_split + 'D' + date_split + year_str
                    + comma_sep + ' H:mm' + seconds_str + use_meridan;
                return {'regex' : date_regexx, 'delim' : delim_str, 'formats' : [date_fmt]};
            }
        }

        // ambiguity: still empty
        return { 'best_guess' : use_braces + 'M' + date_split + 'D' + date_split + year_str
                + ', H:mm' + seconds_str + use_meridan };
    }, {});

    if (!used['regex']) {
        console.log("The input file has an ambigious date format, i.e. couldn't tell if MM/DD or DD/MM. Using MM/DD");
        console.log("Example line: " + lines[0]);
        used.regex = date_regexx;
        used = {'regex' : date_regexx, 'delim' : delim_str, 'formats' : [used.best_guess]};
    }

    lines = lines.reduce(function(total, l) {
        let delim_idx = l.indexOf(used.delim);
        let time_str = l.slice(0, delim_idx);
        if (l.match(used.regex)) {
            total.push(l);
        } else {
            if (total.length > 0) {
                total[total.length - 1] = total[total.length - 1].concat(l);
            }
        }
        return total;
    }, []);
    let full_data = lines.map(function(l) {
        let delim_idx = l.indexOf(used.delim);
        let time_str = l.slice(0, delim_idx);
        if (use_hacky_rm) {
            time_str = time_str.replace('.', '');
        }
        let rest_str = l.slice(delim_idx + 1);
        let colon_idx = rest_str.indexOf(':');
        if (colon_idx == -1) {
            // Found a weird whatsapp notification. Delete
            return {name: 'DELETE_ME'};
        }
        let name_str = rest_str.slice(0, colon_idx);
        let msg_str = rest_str.slice(colon_idx + 1);
        return {name: name_str.trim().split(' ')[0], 'BODY' : msg_str.trim(),
                date: moment(time_str.trim(), used.formats).toDate()};
    });
    let full_filtered_data = full_data.filter(function(d) {
        return d.name != 'DELETE_ME';
    });
    let names = full_filtered_data.reduce(function(total, d) {
        total.add(d.name);
        return total;
    }, new Set());
    var list_names = Array.from(names);
    if (list_names.length > 2) {
        console.log("WARNING: only 2 participants are supported at the moment, we parsed multiple:");
        console.log(list_names);
    }

    return {'names' : list_names, 'data': full_filtered_data};
}

function word_split(row) {
    return row.BODY.replace(/[.,!?\t\n]/g, ' ');
}

function word_reduce(all_words, msg) {
    return all_words.concat(msg.split(' ').filter(function(str) {
        return str.length != 0;
    }));
}

function total_to_from_data(data) {
    return data.names.map(function(n) {
        let name_filt = data.data.filter(function(row) {
            return row.name == n;
        });
        let chars = name_filt.map(function(row) {
            return row.BODY.length;
        });
        let words = name_filt.map(function(d) {
            let tmp = word_split(d);
            return tmp.split(' ').filter(function(str) {
                return str.length != 0;
            }).length;
        });
        return {
            'name' : n,
            'texts' : name_filt.length,
            'chars' : chars,
            'words' : words
        };
    });
}

function get_statistics(just_data) {
    // Stats
    let data_sorted = just_data.sort(d3.ascending);
    let q1 = d3.quantile(data_sorted, .25);
    let q3 = d3.quantile(data_sorted, .75);
    return {
        'min' : data_sorted[0],
        'max' : data_sorted[data_sorted.length - 1],
        'q1' : q1,
        'median' : d3.quantile(data_sorted, .5),
        'q3' : q3,
        'interQuantileRange' : q3 - q1
    };
}

function xy_time_of_day(data) {
    let all_times= [];
    for (var i = 0; i < 24 * 7; i++) {
        all_times.push({'name' : 'both',
                        'hour_day_hash' : i,
                        'hour' : i % 24,
                        'day' : Math.floor(i / 24),
                        'texts' : 0});
    }
    return data.data.map(function(item) {
        return item.date.getHours() + item.date.getDay() * 24;
    }).reduce(function(histo, hash) {
        histo[hash].texts = +histo[hash].texts + 1;
        return histo;
    }, all_times);
}

function xy_time_filter(data, day) {
    if (day == -1) {
        let all_times= [];
        for (var i = 0; i < 24; i++) {
            all_times.push({'name' : 'both',
                            'hour' : i,
                            'texts' : 0});
        }
        return data.reduce(function(histo, d) {
            histo[d.hour].texts = +histo[d.hour].texts + d.texts;
            return histo;
        }, all_times);
    } else {
        return data.filter(function(d) {
            return d.day == day;
        });
    }
}

function xy_time_of_day_sep_person(data) {
    return data.names.map(function(n) {
        let all_hours = [];
        for (var i = 0; i < 24; i++) {
            all_hours.push({'name' : n, 'hour' : i, 'texts' : 0});
        }
        return data.data.filter(function(item) {
            return item.name == n;
        }).map(function(item) {
            return item.date.getHours();
        }).reduce(function(histo, hour) {
            histo[hour].texts = +histo[hour].texts + 1;
            return histo;
        }, all_hours);
    }).reduce(function(total, item) {
        return total.concat(item);
    }, []);
}

function min_max_date(data) {
    return data.data.reduce(function(min_max, row) {
        return [Math.min(min_max[0], row.date.getTime()), Math.max(min_max[1], row.date.getTime())];
    }, [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]).map(function(elem) {
        let tmp = new Date(elem);
        return new Date(tmp.getFullYear(), tmp.getMonth(), tmp.getDate());
    });
}

function milliseconds_in_day() {
    return 1000 * 60 * 60 * 24;
}

function step_dates(min_date, max_date, name) {
    let d = new Date(min_date.getTime());
    let date_array = [];
    let max_date_after = new Date(max_date.getTime() + milliseconds_in_day());
    while (d.getTime() <= max_date_after.getTime()) {
        date_array.push({'name' : name, 'date' : d, 'texts' : 0, 'day_count' : date_array.length});
        d = new Date(d.getTime() + milliseconds_in_day());
    }

    return date_array;
}

function xy_day_of_year(data) {
    let min_max = min_max_date(data);

    let all_days = step_dates(min_max[0], min_max[1], 'both');
    return data.data.map(function(item) {
        return Math.floor((item.date - min_max[0]) / milliseconds_in_day());
    }).reduce(function(histo, day) {
        histo[day].texts = +histo[day].texts + 1;
        return histo;
    }, all_days);
}

function xy_day_of_year_sep_person(data) {
    let min_max = min_max_date(data);

    return data.names.map(function(n) {
        let all_days = step_dates(min_max[0], min_max[1], n);
        return data.data.filter(function(item) {
            return item.name == n;
        }).map(function(item) {
            return Math.floor((item.date - min_max[0]) / milliseconds_in_day());
        }).reduce(function(histo, day) {
            histo[day].texts = +histo[day].texts + 1;
            return histo;
        }, all_days);
    }).reduce(function(total, item) {
        return total.concat(item);
    }, []);
}

function word_count_full(data) {
    return data.names.map(function(n) {
        let word_counts = data.data.filter(function(row) {
            return row.name == n;
        }).map(word_split).reduce(word_reduce, [])
            .reduce(function(histo, word) {
                let word_lower = word.toLowerCase();
                histo[word_lower] = histo[word_lower] ? +histo[word_lower] + 1 : 1;
                return histo;
            }, {});
        return {'name' : n, 'word_count' : word_counts};
    });
}

var emoji_rgx = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/ug;

function word_count_less_diff(word_count_map) {
    let simple_words = ['the', 'and', 'And', 'a', 'to', 'was', 'is', 'of', 'but',
                        'my', 'like', 'this', 'think', 'if', 'all', 'she', 'going', 'her',
                        'i', 'you', 'that', 'it', 'be'];

    let smaller = word_count_map.map(function(n) {
        let tmp_map = {}, key;
        for (key in n.word_count) {
            if (n.word_count.hasOwnProperty(key) && n.word_count[key] > 5
                && !simple_words.includes(key) && !emoji_rgx.test(key)) {
                tmp_map[key] = n.word_count[key];
            }
        }
        return {'name' : n.name, 'word_count' : tmp_map};
    });

    // Assumption of exactly 2 people
    let min_alone = 10;

    let diff = smaller.reduce(function(total, n) {
        if (Object.keys(total).length == 0) {
            return n.word_count;
        }
        var tmp_combine = {}, key;
        for (key in n.word_count) {
            if (n.word_count.hasOwnProperty(key)) {
                if (total.hasOwnProperty(key)) {
                    let diff_val = total[key] - n.word_count[key];
                    tmp_combine[key] = [diff_val,
                        (total[key] + n.word_count[key])];
                } else {
                    if (n.word_count[key] > min_alone) {
                        tmp_combine[key] = [-n.word_count[key], n.word_count[key]];
                    }
                }
            }
        }
        for (key in total) {
            if (!n.word_count.hasOwnProperty(key) && total[key] > min_alone) {
                tmp_combine[key] = [total[key], total[key]];
            }
        }
        return tmp_combine;
    }, {});

    let final_list = [], key;
    for (key in diff) {
        if (diff.hasOwnProperty(key)) {
            final_list.push([diff[key][0] / diff[key][1], diff[key][1], key]);
        }
    }
    return final_list;
}

function emoji_filter(word_count_map) {
    var splitter = new GraphemeSplitter();
    return word_count_map.map(function(x) {
        let tmp_map = {}, key_word;
        for (key_word in x.word_count) {
            if (x.word_count.hasOwnProperty(key_word) && key_word.match(emoji_rgx)) {
                let count = x.word_count[key_word];
                let graphemes = splitter.iterateGraphemes(key_word);
                let result = graphemes.next();
                while (!result.done) {
                    let emj = result.value;
                    if (emoji_rgx.test(emj)) {
                        tmp_map[emj] = tmp_map[emj] ? tmp_map[emj] + count : count;
                    }
                    result = graphemes.next();
                }
            }
        }
        let result = [];
        for (key_word in tmp_map) {
            if (tmp_map.hasOwnProperty(key_word)) {
                result.push([tmp_map[key_word], key_word]);
            }
        }

        return {
            'name' : x.name,
            'emoji_count' : result};
    });
}
