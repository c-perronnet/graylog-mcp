// Hand-curated baseline of Graylog pipeline-rule built-in functions (D-02).
// 133 entries transcribed from RESEARCH §"Built-in Function Catalogue (D-02 source)"
// (lines 485-732 of 04-RESEARCH.md), themselves grep-extracted from
// source-code/graylog2-server/.../plugin/pipelineprocessor/functions/.
//
// Inventory verified against source: `grep "public static final String NAME"`
// across 135 functions/*.java files yields 133 unique NAME values (2 base-class
// shells lack a NAME). `diff <(sort -u source-names) <(sort -u this-list)` is
// empty in both directions — this transcription is empirically complete.
// Plan 04-01 originally specified 130 based on a RESEARCH summary-table sanity
// check; the source-code count is 133. Adjusted as a Rule 1 plan-fix.
//
// Live runtime overlay (D-03) wins on name collisions — see
// function-catalogue.js getMergedCatalogue. Static baseline fills
// description gaps where Graylog's live response carries signature only,
// and is the floor used by validate.js when the live fetch has not yet
// run (Anti-Pattern 2: never trust the live catalogue alone).
//
// Adding a new function: append to the array. Removing: delete entry.
// The frozen array shape (Object.freeze, threat-model T-04-01-02) ensures
// accidental mutation (push/pop/splice) throws TypeError at runtime.

export const staticBuiltins = Object.freeze([
    // root (4)
    { name: "from_input", category: "root", signature: "from_input(id?: string, name?: string): boolean", oneLineDescription: "True when the current message arrived from the given input (by id or name)", sourceRef: "FromInput.java:35" },
    { name: "grok_exists", category: "root", signature: "grok_exists(pattern: string, log_missing?: boolean): boolean", oneLineDescription: "True when the named Grok pattern is registered on the server", sourceRef: "GrokExists.java:36" },
    { name: "is_not_null", category: "root", signature: "is_not_null(value: any): boolean", oneLineDescription: "True when the argument is not null", sourceRef: "IsNotNull.java:30" },
    { name: "is_null", category: "root", signature: "is_null(value: any): boolean", oneLineDescription: "True when the argument is null", sourceRef: "IsNull.java:30" },

    // arrays (3)
    { name: "array_contains", category: "arrays", signature: "array_contains(elements: List, value: any, case_sensitive?: boolean): boolean", oneLineDescription: "True when the array contains the value", sourceRef: "arrays/ArrayContains.java:38" },
    { name: "array_remove", category: "arrays", signature: "array_remove(elements: List, value: any, remove_all?: boolean): List", oneLineDescription: "Returns a new list with the value removed (or all matching values)", sourceRef: "arrays/ArrayRemove.java:33" },
    { name: "string_array_add", category: "arrays", signature: "string_array_add(elements: List, value: string|List, only_unique?: boolean): List<String>", oneLineDescription: "Returns a new string list with values appended", sourceRef: "arrays/StringArrayAdd.java:37" },

    // conversion (16)
    { name: "to_bool", category: "conversion", signature: "to_bool(value: any, default?: boolean): boolean", oneLineDescription: "Convert value to boolean (false default on failure)", sourceRef: "conversion/BooleanConversion.java:31" },
    { name: "csv_to_map", category: "conversion", signature: "csv_to_map(value: string, fieldNames?: List<string>, separator?: string, quoteChar?: string): Map", oneLineDescription: "Parse a CSV row into a map keyed by header names", sourceRef: "conversion/CsvMapConversion.java:44" },
    { name: "to_double", category: "conversion", signature: "to_double(value: any, default?: double): double", oneLineDescription: "Convert value to double (0.0 default on failure)", sourceRef: "conversion/DoubleConversion.java:34" },
    { name: "hex_to_decimal_byte_list", category: "conversion", signature: "hex_to_decimal_byte_list(value: string): List<long>", oneLineDescription: "Convert a hex string into a list of decimal byte values", sourceRef: "conversion/HexToDecimalConversion.java:35" },
    { name: "is_bool", category: "conversion", signature: "is_bool(value: any): boolean", oneLineDescription: "True when the value is a boolean", sourceRef: "conversion/IsBoolean.java:33" },
    { name: "is_collection", category: "conversion", signature: "is_collection(value: any): boolean", oneLineDescription: "True when the value is a list or map", sourceRef: "conversion/IsCollection.java:31" },
    { name: "is_double", category: "conversion", signature: "is_double(value: any): boolean", oneLineDescription: "True when the value is a double", sourceRef: "conversion/IsDouble.java:30" },
    { name: "is_list", category: "conversion", signature: "is_list(value: any): boolean", oneLineDescription: "True when the value is a list", sourceRef: "conversion/IsList.java:31" },
    { name: "is_long", category: "conversion", signature: "is_long(value: any): boolean", oneLineDescription: "True when the value is a long", sourceRef: "conversion/IsLong.java:30" },
    { name: "is_map", category: "conversion", signature: "is_map(value: any): boolean", oneLineDescription: "True when the value is a map", sourceRef: "conversion/IsMap.java:31" },
    { name: "is_number", category: "conversion", signature: "is_number(value: any): boolean", oneLineDescription: "True when the value is numeric", sourceRef: "conversion/IsNumber.java:31" },
    { name: "is_string", category: "conversion", signature: "is_string(value: any): boolean", oneLineDescription: "True when the value is a string", sourceRef: "conversion/IsString.java:29" },
    { name: "to_list", category: "conversion", signature: "to_list(value: any): List", oneLineDescription: "Convert value to a list", sourceRef: "conversion/ListConversion.java:36" },
    { name: "to_long", category: "conversion", signature: "to_long(value: any, default?: long): long", oneLineDescription: "Convert value to long (0 default on failure)", sourceRef: "conversion/LongConversion.java:34" },
    { name: "to_map", category: "conversion", signature: "to_map(value: any): Map", oneLineDescription: "Convert value to a map", sourceRef: "conversion/MapConversion.java:37" },
    { name: "to_string", category: "conversion", signature: "to_string(value: any, default?: string): string", oneLineDescription: "Convert value to string (\"\" default on failure)", sourceRef: "conversion/StringConversion.java:37" },

    // dates (7)
    { name: "to_date", category: "dates", signature: "to_date(value: any, timezone?: string): DateTime", oneLineDescription: "Convert a value to a DateTime in the given timezone (UTC default)", sourceRef: "dates/DateConversion.java:32" },
    { name: "flex_parse_date", category: "dates", signature: "flex_parse_date(value: string, default?: DateTime, timezone?: string, locale?: string): DateTime", oneLineDescription: "Parse a date using a forgiving set of formats", sourceRef: "dates/FlexParseDate.java:35" },
    { name: "format_date", category: "dates", signature: "format_date(value: DateTime, format: string, timezone?: string, locale?: string): string", oneLineDescription: "Format a DateTime using a Joda DateTimeFormatter pattern", sourceRef: "dates/FormatDate.java:33" },
    { name: "is_date", category: "dates", signature: "is_date(value: any): boolean", oneLineDescription: "True when the value is a DateTime", sourceRef: "dates/IsDate.java:32" },
    { name: "now", category: "dates", signature: "now(timezone?: string): DateTime", oneLineDescription: "The current time in the given timezone (UTC default)", sourceRef: "dates/Now.java:30" },
    { name: "parse_date", category: "dates", signature: "parse_date(value: string, pattern: string, locale?: string, timezone?: string): DateTime", oneLineDescription: "Parse a date string with a Joda pattern (e.g. yyyy-MM-dd HH:mm:ss)", sourceRef: "dates/ParseDate.java:33" },
    { name: "parse_unix_milliseconds", category: "dates", signature: "parse_unix_milliseconds(value: long): DateTime", oneLineDescription: "Parse a Unix epoch-millis timestamp into a DateTime", sourceRef: "dates/ParseUnixMilliseconds.java:29" },

    // dates/periods (10)
    { name: "days", category: "dates/periods", signature: "days(value: long): Period", oneLineDescription: "A Period of N days", sourceRef: "dates/periods/Days.java:25" },
    { name: "hours", category: "dates/periods", signature: "hours(value: long): Period", oneLineDescription: "A Period of N hours", sourceRef: "dates/periods/Hours.java:25" },
    { name: "is_period", category: "dates/periods", signature: "is_period(value: any): boolean", oneLineDescription: "True when the value is a Period", sourceRef: "dates/periods/IsPeriod.java:30" },
    { name: "millis", category: "dates/periods", signature: "millis(value: long): Period", oneLineDescription: "A Period of N milliseconds", sourceRef: "dates/periods/Millis.java:25" },
    { name: "minutes", category: "dates/periods", signature: "minutes(value: long): Period", oneLineDescription: "A Period of N minutes", sourceRef: "dates/periods/Minutes.java:25" },
    { name: "months", category: "dates/periods", signature: "months(value: long): Period", oneLineDescription: "A Period of N months", sourceRef: "dates/periods/Months.java:25" },
    { name: "period", category: "dates/periods", signature: "period(value: string): Period", oneLineDescription: "Parse an ISO-8601 period string (P1DT2H)", sourceRef: "dates/periods/PeriodParseFunction.java:29" },
    { name: "seconds", category: "dates/periods", signature: "seconds(value: long): Period", oneLineDescription: "A Period of N seconds", sourceRef: "dates/periods/Seconds.java:25" },
    { name: "weeks", category: "dates/periods", signature: "weeks(value: long): Period", oneLineDescription: "A Period of N weeks", sourceRef: "dates/periods/Weeks.java:25" },
    { name: "years", category: "dates/periods", signature: "years(value: long): Period", oneLineDescription: "A Period of N years", sourceRef: "dates/periods/Years.java:27" },

    // debug (2)
    { name: "debug", category: "debug", signature: "debug(value: any): void", oneLineDescription: "Log the value at INFO via the Graylog logger (debug aid; not a side-effect-free helper)", sourceRef: "debug/Debug.java:35" },
    { name: "metric_counter_inc", category: "debug", signature: "metric_counter_inc(name: string, value?: long): void", oneLineDescription: "Increment a Graylog metric counter", sourceRef: "debug/MetricCounterIncrement.java:32" },

    // encoding (10)
    { name: "base16_decode", category: "encoding", signature: "base16_decode(value: string, omit_padding?: boolean): string", oneLineDescription: "Base16 (hex) decode", sourceRef: "encoding/Base16Decode.java:24" },
    { name: "base16_encode", category: "encoding", signature: "base16_encode(value: string, omit_padding?: boolean): string", oneLineDescription: "Base16 (hex) encode", sourceRef: "encoding/Base16Encode.java:24" },
    { name: "base32_decode", category: "encoding", signature: "base32_decode(value: string, omit_padding?: boolean): string", oneLineDescription: "Base32 decode", sourceRef: "encoding/Base32Decode.java:24" },
    { name: "base32_encode", category: "encoding", signature: "base32_encode(value: string, omit_padding?: boolean): string", oneLineDescription: "Base32 encode", sourceRef: "encoding/Base32Encode.java:24" },
    { name: "base32human_decode", category: "encoding", signature: "base32human_decode(value: string, omit_padding?: boolean): string", oneLineDescription: "Base32 (human variant) decode", sourceRef: "encoding/Base32HumanDecode.java:24" },
    { name: "base32human_encode", category: "encoding", signature: "base32human_encode(value: string, omit_padding?: boolean): string", oneLineDescription: "Base32 (human variant) encode", sourceRef: "encoding/Base32HumanEncode.java:24" },
    { name: "base64_decode", category: "encoding", signature: "base64_decode(value: string, omit_padding?: boolean): string", oneLineDescription: "Base64 decode", sourceRef: "encoding/Base64Decode.java:24" },
    { name: "base64_encode", category: "encoding", signature: "base64_encode(value: string, omit_padding?: boolean): string", oneLineDescription: "Base64 encode", sourceRef: "encoding/Base64Encode.java:24" },
    { name: "base64url_decode", category: "encoding", signature: "base64url_decode(value: string, omit_padding?: boolean): string", oneLineDescription: "Base64-URL decode", sourceRef: "encoding/Base64UrlDecode.java:24" },
    { name: "base64url_encode", category: "encoding", signature: "base64url_encode(value: string, omit_padding?: boolean): string", oneLineDescription: "Base64-URL encode", sourceRef: "encoding/Base64UrlEncode.java:24" },

    // hashing (8)
    { name: "crc32", category: "hashing", signature: "crc32(value: string): string", oneLineDescription: "CRC32 of the input", sourceRef: "hashing/CRC32.java:25" },
    { name: "crc32c", category: "hashing", signature: "crc32c(value: string): string", oneLineDescription: "CRC32C (Castagnoli) of the input", sourceRef: "hashing/CRC32C.java:25" },
    { name: "md5", category: "hashing", signature: "md5(value: string): string", oneLineDescription: "MD5 hex digest of the input", sourceRef: "hashing/MD5.java:23" },
    { name: "murmur3_128", category: "hashing", signature: "murmur3_128(value: string): string", oneLineDescription: "128-bit MurmurHash3 of the input", sourceRef: "hashing/Murmur3_128.java:25" },
    { name: "murmur3_32", category: "hashing", signature: "murmur3_32(value: string): string", oneLineDescription: "32-bit MurmurHash3 of the input", sourceRef: "hashing/Murmur3_32.java:25" },
    { name: "sha1", category: "hashing", signature: "sha1(value: string): string", oneLineDescription: "SHA-1 hex digest of the input", sourceRef: "hashing/SHA1.java:23" },
    { name: "sha256", category: "hashing", signature: "sha256(value: string): string", oneLineDescription: "SHA-256 hex digest of the input", sourceRef: "hashing/SHA256.java:23" },
    { name: "sha512", category: "hashing", signature: "sha512(value: string): string", oneLineDescription: "SHA-512 hex digest of the input", sourceRef: "hashing/SHA512.java:23" },

    // ips (4)
    { name: "cidr_match", category: "ips", signature: "cidr_match(cidr: string, ip: IpAddress): boolean", oneLineDescription: "True when the IP falls inside the CIDR block", sourceRef: "ips/CidrMatch.java:32" },
    { name: "to_ip", category: "ips", signature: "to_ip(value: string, default?: string): IpAddress", oneLineDescription: "Convert a string to an IpAddress", sourceRef: "ips/IpAddressConversion.java:36" },
    { name: "anonymize_ip", category: "ips", signature: "anonymize_ip(value: string|IpAddress): IpAddress", oneLineDescription: "Zero the host bits to anonymize an IP", sourceRef: "ips/IpAnonymize.java:30" },
    { name: "is_ip", category: "ips", signature: "is_ip(value: any): boolean", oneLineDescription: "True when the value parses as an IP address", sourceRef: "ips/IsIp.java:31" },

    // json (4)
    { name: "is_json", category: "json", signature: "is_json(value: any): boolean", oneLineDescription: "True when the value is a JsonNode (parsed JSON)", sourceRef: "json/IsJson.java:30" },
    { name: "flatten_json", category: "json", signature: "flatten_json(value: string, stringify?: boolean, array_handler?: string): Map", oneLineDescription: "Flatten JSON into a single-level map with dotted keys", sourceRef: "json/JsonFlatten.java:36" },
    { name: "parse_json", category: "json", signature: "parse_json(value: string): JsonNode", oneLineDescription: "Parse a JSON string into a JsonNode tree", sourceRef: "json/JsonParse.java:38" },
    { name: "select_jsonpath", category: "json", signature: "select_jsonpath(json: JsonNode, paths: Map<string,string>): Map", oneLineDescription: "Extract fields from JSON via JsonPath expressions", sourceRef: "json/SelectJsonPath.java:47" },

    // lookup (14)
    { name: "list_count", category: "lookup", signature: "list_count(lookup_table: string, key: any): long", oneLineDescription: "Count entries in a string-list lookup-table value", sourceRef: "lookup/ListCount.java:32" },
    { name: "list_get", category: "lookup", signature: "list_get(lookup_table: string, key: any, index: long): any", oneLineDescription: "Get the Nth entry of a string-list lookup-table value", sourceRef: "lookup/ListGet.java:33" },
    { name: "lookup", category: "lookup", signature: "lookup(lookup_table: string, key: any, default?: any): LookupResult", oneLineDescription: "Look up a key; returns a LookupResult with value/single_value/multi_value", sourceRef: "lookup/Lookup.java:40" },
    { name: "lookup_add_string_list", category: "lookup", signature: "lookup_add_string_list(lookup_table: string, key: any, value: List<string>, keep_duplicates?: boolean): LookupResult", oneLineDescription: "Append to a string-list lookup-table value", sourceRef: "lookup/LookupAddStringList.java:37" },
    { name: "lookup_all", category: "lookup", signature: "lookup_all(lookup_table: string, keys: List): LookupResult", oneLineDescription: "Look up multiple keys; merged result", sourceRef: "lookup/LookupAll.java:44" },
    { name: "lookup_assign_ttl", category: "lookup", signature: "lookup_assign_ttl(lookup_table: string, key: any, ttl?: long): LookupResult", oneLineDescription: "Set/refresh the TTL on a lookup-table entry", sourceRef: "lookup/LookupAssignTtl.java:34" },
    { name: "lookup_clear_key", category: "lookup", signature: "lookup_clear_key(lookup_table: string, key: any): LookupResult", oneLineDescription: "Remove a key from a lookup table", sourceRef: "lookup/LookupClearKey.java:34" },
    { name: "lookup_has_value", category: "lookup", signature: "lookup_has_value(lookup_table: string, key: any): boolean", oneLineDescription: "True when the key has a non-empty value", sourceRef: "lookup/LookupHasValue.java:35" },
    { name: "lookup_remove_string_list", category: "lookup", signature: "lookup_remove_string_list(lookup_table: string, key: any, value: List<string>): LookupResult", oneLineDescription: "Remove values from a string-list lookup-table value", sourceRef: "lookup/LookupRemoveStringList.java:36" },
    { name: "lookup_set_string_list", category: "lookup", signature: "lookup_set_string_list(lookup_table: string, key: any, value: List<string>, ttl?: long): LookupResult", oneLineDescription: "Replace a string-list lookup-table value", sourceRef: "lookup/LookupSetStringList.java:37" },
    { name: "lookup_set_value", category: "lookup", signature: "lookup_set_value(lookup_table: string, key: any, value: any, ttl?: long): LookupResult", oneLineDescription: "Set/overwrite a lookup-table single value", sourceRef: "lookup/LookupSetValue.java:36" },
    { name: "lookup_string_list", category: "lookup", signature: "lookup_string_list(lookup_table: string, key: any, default?: List<string>): List<string>", oneLineDescription: "Get the string-list value for a key", sourceRef: "lookup/LookupStringList.java:39" },
    { name: "lookup_string_list_contains", category: "lookup", signature: "lookup_string_list_contains(lookup_table: string, key: any, value: string): boolean", oneLineDescription: "True when the string-list value contains the given string", sourceRef: "lookup/LookupStringListContains.java:35" },
    { name: "lookup_value", category: "lookup", signature: "lookup_value(lookup_table: string, key: any, default?: any): any", oneLineDescription: "Single-value convenience: returns lookup().single_value", sourceRef: "lookup/LookupValue.java:35" },

    // maps (4)
    { name: "map_copy", category: "maps", signature: "map_copy(map: Map): Map", oneLineDescription: "Shallow copy of a map", sourceRef: "maps/MapCopy.java:34" },
    { name: "map_get", category: "maps", signature: "map_get(map: Map, key: any, default?: any): any", oneLineDescription: "Get a value from a map by key", sourceRef: "maps/MapGet.java:34" },
    { name: "map_remove", category: "maps", signature: "map_remove(map: Map, key: any): Map", oneLineDescription: "Remove a key from a map (returns the modified map)", sourceRef: "maps/MapRemove.java:34" },
    { name: "map_set", category: "maps", signature: "map_set(map: Map, key: any, value: any): Map", oneLineDescription: "Set a key/value in a map (returns the modified map)", sourceRef: "maps/MapSet.java:35" },

    // messages (17)
    { name: "clone_message", category: "messages", signature: "clone_message(message?: Message): Message", oneLineDescription: "Clone the current (or named) message and emit it for further processing", sourceRef: "messages/CloneMessage.java:40" },
    { name: "create_message", category: "messages", signature: "create_message(message?: string, source?: string, timestamp?: DateTime): Message", oneLineDescription: "Create a brand-new message in addition to the current one", sourceRef: "messages/CreateMessage.java:39" },
    { name: "drop_message", category: "messages", signature: "drop_message(message?: Message): void", oneLineDescription: "Drop the current (or named) message so it is not stored or routed further", sourceRef: "messages/DropMessage.java:32" },
    { name: "get_field", category: "messages", signature: "get_field(field: string, message?: Message): any", oneLineDescription: "Read a field value from the message", sourceRef: "messages/GetField.java:32" },
    { name: "has_field", category: "messages", signature: "has_field(field: string, message?: Message): boolean", oneLineDescription: "True when the message has the named field", sourceRef: "messages/HasField.java:32" },
    { name: "normalize_fields", category: "messages", signature: "normalize_fields(message?: Message): void", oneLineDescription: "Lowercase + sanitize all field names on the message", sourceRef: "messages/NormalizeFields.java:35" },
    { name: "remove_field", category: "messages", signature: "remove_field(field: string, message?: Message): void", oneLineDescription: "Remove a single field from the message", sourceRef: "messages/RemoveField.java:34" },
    { name: "remove_from_stream", category: "messages", signature: "remove_from_stream(id?: string, name?: string, message?: Message): void", oneLineDescription: "Detach the message from a stream by ID or name", sourceRef: "messages/RemoveFromStream.java:42" },
    { name: "remove_multiple_fields", category: "messages", signature: "remove_multiple_fields(pattern?: string, names?: List<string>, message?: Message): void", oneLineDescription: "Remove multiple fields by regex pattern or name list", sourceRef: "messages/RemoveMultipleFields.java:34" },
    { name: "remove_single_field", category: "messages", signature: "remove_single_field(field: string, message?: Message): void", oneLineDescription: "Remove a single field (legacy synonym for remove_field)", sourceRef: "messages/RemoveSingleField.java:31" },
    { name: "remove_string_fields_by_value", category: "messages", signature: "remove_string_fields_by_value(value: string, message?: Message): void", oneLineDescription: "Remove all string-valued fields whose value matches", sourceRef: "messages/RemoveStringFieldsByValue.java:39" },
    { name: "rename_field", category: "messages", signature: "rename_field(old_field: string, new_field: string, message?: Message): void", oneLineDescription: "Rename a single field", sourceRef: "messages/RenameField.java:32" },
    { name: "rename_fields", category: "messages", signature: "rename_fields(pattern: string, replacement: string, message?: Message): void", oneLineDescription: "Rename fields whose name matches a regex pattern", sourceRef: "messages/RenameFields.java:33" },
    { name: "route_to_stream", category: "messages", signature: "route_to_stream(id?: string, name?: string, message?: Message, remove_from_default?: boolean): void", oneLineDescription: "Attach the message to a stream by ID or name", sourceRef: "messages/RouteToStream.java:43" },
    { name: "set_field", category: "messages", signature: "set_field(field: string, value: any, prefix?: string, suffix?: string, message?: Message, default?: any, clean_field?: boolean): void", oneLineDescription: "Add or overwrite a single field on the message", sourceRef: "messages/SetField.java:38" },
    { name: "set_fields", category: "messages", signature: "set_fields(fields: Map, prefix?: string, suffix?: string, message?: Message, clean_field?: boolean): void", oneLineDescription: "Add or overwrite multiple fields from a Map", sourceRef: "messages/SetFields.java:37" },
    { name: "traffic_accounting_size", category: "messages", signature: "traffic_accounting_size(category?: string, message?: Message): long", oneLineDescription: "Return the accounted byte size of the message", sourceRef: "messages/TrafficAccountingSize.java:30" },

    // strings (22)
    { name: "abbreviate", category: "strings", signature: "abbreviate(value: string, width: long): string", oneLineDescription: "Abbreviate a string to N chars, ellipsizing the middle", sourceRef: "strings/Abbreviate.java:32" },
    { name: "capitalize", category: "strings", signature: "capitalize(value: string): string", oneLineDescription: "Capitalize the first character", sourceRef: "strings/Capitalize.java:26" },
    { name: "concat", category: "strings", signature: "concat(first: string, second: string): string", oneLineDescription: "Concatenate two strings", sourceRef: "strings/Concat.java:30" },
    { name: "contains", category: "strings", signature: "contains(value: string, search: string, ignore_case?: boolean): boolean", oneLineDescription: "True when the substring appears in the string", sourceRef: "strings/Contains.java:30" },
    { name: "ends_with", category: "strings", signature: "ends_with(value: string, suffix: string, ignore_case?: boolean): boolean", oneLineDescription: "True when the string ends with the suffix", sourceRef: "strings/EndsWith.java:30" },
    { name: "first_non_null", category: "strings", signature: "first_non_null(values: List): any", oneLineDescription: "Returns the first non-null entry in the list", sourceRef: "strings/FirstNonNull.java:30" },
    { name: "grok", category: "strings", signature: "grok(pattern: string, value: string, only_named_captures?: boolean): Map", oneLineDescription: "Apply a Grok pattern to a string and return captures as a Map", sourceRef: "strings/GrokMatch.java:36" },
    { name: "join", category: "strings", signature: "join(elements: List, delimiter?: string, start?: long, end?: long): string", oneLineDescription: "Join list elements into a string (delimiter default \",\")", sourceRef: "strings/Join.java:34" },
    { name: "key_value", category: "strings", signature: "key_value(value: string, delimiters?: string, kv_delimiters?: string, ignore_empty_values?: boolean, allow_dup_keys?: boolean, handle_dup_keys?: string, trim_key_chars?: string, trim_value_chars?: string): Map", oneLineDescription: "Parse a key-value formatted string into a Map", sourceRef: "strings/KeyValue.java:42" },
    { name: "length", category: "strings", signature: "length(value: string, bytes?: boolean): long", oneLineDescription: "Return the character (or byte) length of the string", sourceRef: "strings/Length.java:32" },
    { name: "lowercase", category: "strings", signature: "lowercase(value: string, locale?: string): string", oneLineDescription: "Lowercase a string", sourceRef: "strings/Lowercase.java:26" },
    { name: "multi_grok", category: "strings", signature: "multi_grok(patterns: List<string>, value: string, only_named_captures?: boolean): Map", oneLineDescription: "Apply multiple Grok patterns; first match wins", sourceRef: "strings/MultiGrokMatch.java:40" },
    { name: "regex", category: "strings", signature: "regex(pattern: string, value: string, group_names?: List<string>): Map", oneLineDescription: "Apply a regex pattern; returns the matches as a Map", sourceRef: "strings/RegexMatch.java:39" },
    { name: "regex_replace", category: "strings", signature: "regex_replace(pattern: string, value: string, replacement: string, replace_all?: boolean): string", oneLineDescription: "Replace regex matches with a replacement", sourceRef: "strings/RegexReplace.java:33" },
    { name: "replace", category: "strings", signature: "replace(value: string, search: string, replacement?: string, max?: long): string", oneLineDescription: "Replace literal substring occurrences", sourceRef: "strings/Replace.java:31" },
    { name: "split", category: "strings", signature: "split(pattern: string, value: string, limit?: long): List<string>", oneLineDescription: "Split a string by a regex pattern", sourceRef: "strings/Split.java:40" },
    { name: "starts_with", category: "strings", signature: "starts_with(value: string, prefix: string, ignore_case?: boolean): boolean", oneLineDescription: "True when the string starts with the prefix", sourceRef: "strings/StartsWith.java:30" },
    { name: "string_entropy", category: "strings", signature: "string_entropy(value: string): double", oneLineDescription: "Compute the Shannon entropy of a string", sourceRef: "strings/StringEntropy.java:28" },
    { name: "substring", category: "strings", signature: "substring(value: string, start: long, end?: long): string", oneLineDescription: "Extract a substring by character offsets", sourceRef: "strings/Substring.java:32" },
    { name: "swapcase", category: "strings", signature: "swapcase(value: string): string", oneLineDescription: "Swap upper/lower case", sourceRef: "strings/Swapcase.java:26" },
    { name: "uncapitalize", category: "strings", signature: "uncapitalize(value: string): string", oneLineDescription: "Lowercase the first character", sourceRef: "strings/Uncapitalize.java:26" },
    { name: "uppercase", category: "strings", signature: "uppercase(value: string, locale?: string): string", oneLineDescription: "Uppercase a string", sourceRef: "strings/Uppercase.java:26" },

    // syslog (4)
    { name: "syslog_facility", category: "syslog", signature: "syslog_facility(value: any): string", oneLineDescription: "Return the syslog facility text for a numeric priority", sourceRef: "syslog/SyslogFacilityConversion.java:31" },
    { name: "syslog_level", category: "syslog", signature: "syslog_level(value: any): string", oneLineDescription: "Return the syslog severity text for a numeric priority", sourceRef: "syslog/SyslogLevelConversion.java:31" },
    { name: "expand_syslog_priority", category: "syslog", signature: "expand_syslog_priority(value: any): Map", oneLineDescription: "Expand a syslog priority into facility/severity components (numeric)", sourceRef: "syslog/SyslogPriorityConversion.java:29" },
    { name: "expand_syslog_priority_as_string", category: "syslog", signature: "expand_syslog_priority_as_string(value: any): Map", oneLineDescription: "Expand a syslog priority into facility/severity components (text)", sourceRef: "syslog/SyslogPriorityToStringConversion.java:29" },

    // urls (4)
    { name: "is_url", category: "urls", signature: "is_url(value: any): boolean", oneLineDescription: "True when the value parses as a URL", sourceRef: "urls/IsUrl.java:29" },
    { name: "to_url", category: "urls", signature: "to_url(value: string, default?: string): URL", oneLineDescription: "Convert a string to a URL", sourceRef: "urls/UrlConversion.java:36" },
    { name: "urldecode", category: "urls", signature: "urldecode(value: string, charset?: string): string", oneLineDescription: "URL-decode a string", sourceRef: "urls/UrlDecode.java:33" },
    { name: "urlencode", category: "urls", signature: "urlencode(value: string, charset?: string): string", oneLineDescription: "URL-encode a string", sourceRef: "urls/UrlEncode.java:33" },
]);
