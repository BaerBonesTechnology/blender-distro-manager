# Blender Distro Manager shared-library bridge. No manager process is required.
import bpy
import addon_utils
import json
import os
from bpy.app.handlers import persistent

STATE_FILE = __BDM_STATE_FILE__

@persistent
def apply_shared_addons(*_args):
    try:
        with open(STATE_FILE, encoding='utf8') as handle:
            state = json.load(handle)
        settings = state.get(os.path.realpath(bpy.app.binary_path))
        if settings is None:
            return
        for item in settings:
            module = item['module']
            try:
                if item['enabled']:
                    if not addon_utils.check(module)[1]:
                        addon_utils.enable(module, default_set=True, persistent=True)
                elif addon_utils.check(module)[1]:
                    addon_utils.disable(module, default_set=True)
            except Exception as error:
                print('Blender Distro Manager:', module, error)
    except FileNotFoundError:
        pass
    except Exception as error:
        print('Blender Distro Manager:', error)


def register():
    bpy.app.handlers.load_post.append(apply_shared_addons)
    # Extension namespaces are initialized after startup modules register.
    bpy.app.timers.register(apply_shared_addons, first_interval=0.0)


def unregister():
    if apply_shared_addons in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.remove(apply_shared_addons)
    if bpy.app.timers.is_registered(apply_shared_addons):
        bpy.app.timers.unregister(apply_shared_addons)
