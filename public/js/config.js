// 视频会议管理后台 - 配置模块
(function(window) {
	'use strict';
	
	const _k = 'huiyi_admin_login';
	const _s = 'huiyi_unified_console_single';
	
	// 重置缓存（删除配置后调用）
	function resetConfig() {}
	
	window.HuiyiConfig = {
		LOGIN_KEY: _k,
		STORAGE_KEY: _s,
		resetConfig: resetConfig
	};
})(window);
