/**
 * Main menu panel
 *
 * @author Guangcong Luo <guangcongluo@gmail.com>
 * @license AGPLv3
 */

type RoomInfo = {title: string, desc?: string, userCount?: number, subRooms?: string[]};

class MainMenuRoom extends PSRoom {
	readonly classType: string = 'mainmenu';
	userdetailsCache: {[userid: string]: {
		userid: ID,
		avatar?: string | number,
		group?: string,
		rooms?: {[roomid: string]: {isPrivate?: true, p1?: string, p2?: string}},
	}} = {};
	roomsCache: {
		battleCount?: number,
		userCount?: number,
		chat?: RoomInfo[],
		official?: RoomInfo[],
		pspl?: RoomInfo[],
	} = {};
	receive(line: string) {
		const tokens = BattleTextParser.parseLine(line);
		switch (tokens[0]) {
		case 'challstr':
			PSLoginServer.query({
				act: 'upkeep',
				challstr: tokens[1],
			}, res => {
				if (!res) return;
				if (!res.loggedin) return;
				this.send(`/trn ${res.username},0,${res.assertion}`);
			});
			return;
		case 'updateuser':
			PS.user.setName(tokens[1], tokens[2] === '1', tokens[3]);
			return;
		case 'updatechallenges':
			this.receiveChallenges(tokens[1]);
			return;
		case 'queryresponse':
			this.handleQueryResponse(tokens[1] as ID, JSON.parse(tokens[2]));
			return;
		case 'pm':
			this.handlePM(tokens[1], tokens[2], tokens[3]);
			return;
		case 'formats':
			this.parseFormats(tokens);
			return;
		case 'popup':
			alert(tokens[1]);
			return;
		}
		const lobby = PS.rooms['lobby'];
		if (lobby) lobby.receive(line);
	}
	receiveChallenges(dataBuf: string) {
		let json;
		try {
			json = JSON.parse(dataBuf);
		} catch {}
		for (const userid in json.challengesFrom) {
			PS.getPMRoom(toID(userid));
		}
		if (json.challengeTo) {
			PS.getPMRoom(toID(json.challengeTo.to));
		}
		for (const roomid in PS.rooms) {
			const room = PS.rooms[roomid] as ChatRoom;
			if (!room.pmTarget) continue;
			const targetUserid = toID(room.pmTarget);
			if (!room.challengedFormat && !(targetUserid in json.challengesFrom) &&
				!room.challengingFormat && json.challengeTo?.to !== targetUserid) {
				continue;
			}
			room.challengedFormat = json.challengesFrom[targetUserid] || null;
			room.challengingFormat = json.challengeTo?.to === targetUserid ? json.challengeTo.format : null;
			room.update('');
		}
	}
	parseFormats(formatsList: string[]) {
		let isSection = false;
		let section = '';

		let column = 0;

		window.BattleFormats = {};
		for (let j = 1; j < formatsList.length; j++) {
			const entry = formatsList[j];
			if (isSection) {
				section = entry;
				isSection = false;
			} else if (entry === ',LL') {
				PS.teams.usesLocalLadder = true;
			} else if (entry === '' || (entry.charAt(0) === ',' && !isNaN(Number(entry.slice(1))))) {
				isSection = true;

				if (entry) {
					column = parseInt(entry.slice(1), 10) || 0;
				}
			} else {
				let name = entry;
				let searchShow = true;
				let challengeShow = true;
				let tournamentShow = true;
				let team: 'preset' | null = null;
				let teambuilderLevel: number | null = null;
				let lastCommaIndex = name.lastIndexOf(',');
				let code = lastCommaIndex >= 0 ? parseInt(name.substr(lastCommaIndex + 1), 16) : NaN;
				if (!isNaN(code)) {
					name = name.substr(0, lastCommaIndex);
					if (code & 1) team = 'preset';
					if (!(code & 2)) searchShow = false;
					if (!(code & 4)) challengeShow = false;
					if (!(code & 8)) tournamentShow = false;
					if (code & 16) teambuilderLevel = 50;
				} else {
					// Backwards compatibility: late 0.9.0 -> 0.10.0
					if (name.substr(name.length - 2) === ',#') { // preset teams
						team = 'preset';
						name = name.substr(0, name.length - 2);
					}
					if (name.substr(name.length - 2) === ',,') { // search-only
						challengeShow = false;
						name = name.substr(0, name.length - 2);
					} else if (name.substr(name.length - 1) === ',') { // challenge-only
						searchShow = false;
						name = name.substr(0, name.length - 1);
					}
				}
				let id = toID(name);
				let isTeambuilderFormat = !team && name.slice(-11) !== 'Custom Game';
				let teambuilderFormat = '' as ID;
				let teambuilderFormatName = '';
				if (isTeambuilderFormat) {
					teambuilderFormatName = name;
					if (id.slice(0, 3) !== 'gen') {
						teambuilderFormatName = '[Gen 6] ' + name;
					}
					let parenPos = teambuilderFormatName.indexOf('(');
					if (parenPos > 0 && name.slice(-1) === ')') {
						// variation of existing tier
						teambuilderFormatName = teambuilderFormatName.slice(0, parenPos).trim();
					}
					if (teambuilderFormatName !== name) {
						teambuilderFormat = toID(teambuilderFormatName);
						if (BattleFormats[teambuilderFormat]) {
							BattleFormats[teambuilderFormat].isTeambuilderFormat = true;
						} else {
							BattleFormats[teambuilderFormat] = {
								id: teambuilderFormat,
								name: teambuilderFormatName,
								team,
								section,
								column,
								rated: false,
								isTeambuilderFormat: true,
								effectType: 'Format',
							};
						}
						isTeambuilderFormat = false;
					}
				}
				if (BattleFormats[id]?.isTeambuilderFormat) {
					isTeambuilderFormat = true;
				}
				// make sure formats aren't out-of-order
				if (BattleFormats[id]) delete BattleFormats[id];
				BattleFormats[id] = {
					id,
					name,
					team,
					section,
					column,
					searchShow,
					challengeShow,
					tournamentShow,
					rated: searchShow && id.substr(4, 7) !== 'unrated',
					teambuilderLevel,
					teambuilderFormat,
					isTeambuilderFormat,
					effectType: 'Format',
				};
			}
		}

		// Match base formats to their variants, if they are unavailable in the server.
		let multivariantFormats: {[id: string]: 1} = {};
		for (let id in BattleFormats) {
			let teambuilderFormat = BattleFormats[BattleFormats[id].teambuilderFormat!];
			if (!teambuilderFormat || multivariantFormats[teambuilderFormat.id]) continue;
			if (!teambuilderFormat.searchShow && !teambuilderFormat.challengeShow && !teambuilderFormat.tournamentShow) {
				// The base format is not available.
				if (teambuilderFormat.battleFormat) {
					multivariantFormats[teambuilderFormat.id] = 1;
					teambuilderFormat.battleFormat = '';
				} else {
					teambuilderFormat.battleFormat = id;
				}
			}
		}
		PS.teams.update('format');
	}
	handlePM(user1: string, user2: string, message: string) {
		const userid1 = toID(user1);
		const userid2 = toID(user2);
		const roomid = `pm-${[userid1, userid2].sort().join('-')}` as RoomID;
		let room = PS.rooms[roomid];
		if (!room) {
			const pmTarget = PS.user.userid === userid1 ? user2 : user1;
			PS.addRoom({
				id: roomid,
				pmTarget,
			}, true);
			room = PS.rooms[roomid]!;
		}
		room.receive(`|c|${user1}|${message}`);
		PS.update();
	}
	handleQueryResponse(id: ID, response: any) {
		switch (id) {
		case 'userdetails':
			let userid = response.userid;
			let userdetails = this.userdetailsCache[userid];
			if (!userdetails) {
				this.userdetailsCache[userid] = response;
			} else {
				Object.assign(userdetails, response);
			}
			const userRoom = PS.rooms[`user-${userid}`] as UserRoom;
			if (userRoom) userRoom.update('');
			break;
		case 'rooms':
			this.roomsCache = response;
			const roomsRoom = PS.rooms[`rooms`] as RoomsRoom;
			if (roomsRoom) roomsRoom.update('');
			break;
		}
	}
}

class NewsPanel extends PSRoomPanel {
	render() {
		return <PSPanelWrapper room={this.props.room} scrollable>
			<div class="mini-window-body" dangerouslySetInnerHTML={{__html: PS.newsHTML}}></div>
		</PSPanelWrapper>;
	}
}

class MainMenuPanel extends PSRoomPanel<MainMenuRoom> {
	focus() {
		(this.base!.querySelector('button.big') as HTMLButtonElement).focus();
	}
	submit = (e: Event) => {
		alert('todo: implement');
	};
	renderMiniRoom(room: PSRoom) {
		const roomType = PS.roomTypes[room.type];
		const Panel = roomType ? roomType.Component : PSRoomPanel;
		return <Panel key={room.id} room={room} />;
	}
	renderMiniRooms() {
		return PS.miniRoomList.map(roomid => {
			const room = PS.rooms[roomid]!;
			return <div class="pmbox">
				<div class="mini-window">
					<h3>
						<button class="closebutton" name="closeRoom" value={roomid} aria-label="Close" tabIndex={-1}><i class="fa fa-times-circle"></i></button>
						<button class="minimizebutton" tabIndex={-1}><i class="fa fa-minus-circle"></i></button>
						{room.title}
					</h3>
					{this.renderMiniRoom(room)}
				</div>
			</div>;
		});
	}
	render() {
		const onlineButton = ' button' + (PS.isOffline ? ' disabled' : '');
		const searchButton = (PS.down ? <div class="menugroup" style="background: rgba(10,10,10,.6)">
			{PS.down === 'ddos' ?
				<p class="error"><strong>Pok&eacute;mon Showdown is offline due to a DDoS attack!</strong></p>
			:
				<p class="error"><strong>Pok&eacute;mon Showdown is offline due to technical difficulties!</strong></p>
			}
			<p>
				<div style={{textAlign: 'center'}}>
					<img width="96" height="96" src="//play.pokemonshowdown.com/sprites/gen5/teddiursa.png" alt="" />
				</div>
				Bear with us as we freak out.
			</p>
			<p>(We'll be back up in a few hours.)</p>
		</div> : <TeamForm class="menugroup" onSubmit={this.submit}>
			<button class={"mainmenu1 big" + onlineButton} name="search">
				<strong>Battle!</strong><br />
				<small>Find a random opponent</small>
			</button>
		</TeamForm>);
		return <PSPanelWrapper room={this.props.room} scrollable>
			<div class="mainmenuwrapper">
				<div class="leftmenu">
					<div class="activitymenu">
						{this.renderMiniRooms()}
					</div>
					<div class="mainmenu">
						{searchButton}

						<div class="menugroup">
							<p><button class="mainmenu2 button" name="joinRoom" value="teambuilder">Teambuilder</button></p>
							<p><button class={"mainmenu3" + onlineButton} name="joinRoom" value="ladder">Ladder</button></p>
						</div>

						<div class="menugroup">
							<p><button class={"mainmenu4" + onlineButton} name="joinRoom" value="battles">Watch a battle</button></p>
							<p><button class={"mainmenu5" + onlineButton} name="finduser">Find a user</button></p>
						</div>
					</div>
				</div>
				<div class="rightmenu" style={{display: PS.leftRoomWidth ? 'none' : 'block'}}>
					<div class="menugroup">
						{PS.server.id === 'showdown' ?
							<p><button class={"mainmenu1" + onlineButton} name="joinRoom" value="rooms">Join chat</button></p>
						:
							<p><button class={"mainmenu1" + onlineButton} name="joinRoom" value="lobby">Join lobby chat</button></p>
						}
					</div>
				</div>
				<div class="mainmenufooter">
					<div class="bgcredit"></div>
					<small>
						<a href="//dex.pokemonshowdown.com/" target="_blank">Pok&eacute;dex</a> | {}
						<a href="//replay.pokemonshowdown.com/" target="_blank">Replays</a> | {}
						<a href="//pokemonshowdown.com/rules" target="_blank">Rules</a> | {}
						<a href="//pokemonshowdown.com/credits" target="_blank">Credits</a> | {}
						<a href="//smogon.com/forums/" target="_blank">Forum</a>
					</small>
				</div>
			</div>
		</PSPanelWrapper>;
	}
}

class FormatDropdown extends preact.Component<{format?: string, onChange?: JSX.EventHandler<Event>}> {
	base?: HTMLButtonElement;
	getFormat() {
		return this.base?.value || '[Gen 7] Random Battle';
	}
	componentDidMount() {
		this.base!.value = this.getFormat();
	}
	change = (e: Event) => {
		this.forceUpdate();
		if (this.props.onChange) this.props.onChange(e);
	};
	render() {
		if (this.props.format) {
			return <button
				class="select formatselect preselected" name="format" value={this.props.format} disabled
			>{this.props.format}</button>;
		}
		const format = this.getFormat();
		return <button class="select formatselect" name="format" data-href="/formatdropdown" onChange={this.change}>
			{format}
		</button>;
	}
}

class TeamDropdown extends preact.Component<{format: string}> {
	base?: HTMLButtonElement;
	getTeam() {
		if (this.base) {
			const key = this.base.value;
			return PS.teams.byKey[key] || null;
		}
		const formatid = PS.teams.teambuilderFormat(this.props.format);
		for (const team of PS.teams.list) {
			if (team.format === formatid) return team;
		}
		return null;
	}
	componentDidMount() {
		const team = this.getTeam();
		if (team) {
			this.base!.value = team.key;
		}
	}
	change = () => this.forceUpdate();
	render() {
		const formatid = PS.teams.teambuilderFormat(this.props.format);
		const formatData = window.BattleFormats?.[formatid];
		if (formatData && formatData.team) {
			return <button class="select teamselect preselected" name="team" value="random" disabled>
				<div class="team">
					<strong>Random team</strong>
					<small>
						<span class="picon" style="float:left;background:transparent url(https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png?a6) no-repeat scroll -0px -0px"></span>
						<span class="picon" style="float:left;background:transparent url(https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png?a6) no-repeat scroll -0px -0px"></span>
						<span class="picon" style="float:left;background:transparent url(https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png?a6) no-repeat scroll -0px -0px"></span>
						<span class="picon" style="float:left;background:transparent url(https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png?a6) no-repeat scroll -0px -0px"></span>
						<span class="picon" style="float:left;background:transparent url(https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png?a6) no-repeat scroll -0px -0px"></span>
						<span class="picon" style="float:left;background:transparent url(https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png?a6) no-repeat scroll -0px -0px"></span>
					</small>
				</div>
			</button>;
		}
		const team = this.getTeam();
		let teambox = null;
		if (PS.roomTypes['teamdropdown']) {
			teambox = <TeamBox team={team} noLink />;
		}
		return <button class="select teamselect" name="team" data-href="/teamdropdown" data-format={formatid} onChange={this.change}>
			{teambox}
		</button>;
	}
}

class TeamForm extends preact.Component<{
	children: preact.ComponentChildren, class?: string, format?: string,
	onSubmit: null | ((e: Event, format: string, team?: Team) => void),
}> {
	state = {format: '[Gen 7] Random Battle'};
	changeFormat = (e: Event) => {
		this.setState({format: (e.target as HTMLButtonElement).value});
	};
	submit = (e: Event) => {
		e.preventDefault();
		const format = (this.base!.querySelector('button[name=format]') as HTMLButtonElement).value;
		const teamKey = (this.base!.querySelector('button[name=team]') as HTMLButtonElement).value;
		const team = teamKey ? PS.teams.byKey[teamKey] : undefined;
		if (this.props.onSubmit) this.props.onSubmit(e, format, team);
	};
	render() {
		return <form class={this.props.class} onSubmit={this.submit}>
			<p>
				<label class="label">
					Format:<br />
					<FormatDropdown onChange={this.changeFormat} format={this.props.format} />
				</label>
			</p>
			<p>
				<label class="label">
					Team:<br />
					<TeamDropdown format={this.state.format} />
				</label>
			</p>
			<p>{this.props.children}</p>
		</form>;
	}
}

PS.roomTypes['news'] = {
	Component: NewsPanel,
};

PS.roomTypes['mainmenu'] = {
	Model: MainMenuRoom,
	Component: MainMenuPanel,
};
